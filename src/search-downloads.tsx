/**
 * Search Downloads - Helium Browser Controller
 * Browse, search, and manage browser downloads across all profiles
 * @author Just_Me
 */

import { List, showToast, Toast, Action, ActionPanel, Icon, showHUD, confirmAlert, Alert, Clipboard } from "@raycast/api";
import { useState, useEffect, useCallback } from "react";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Utility imports
import { findHeliumPath } from "./utils/browser";
import { getDomain, getFaviconUrl, formatDate, formatAbsoluteDate, formatFileSize, convertChromiumTimestamp } from "./utils/formatters";
import { launchUrlInBrowser, openFileInExplorer, openFileDirectly } from "./utils/shell";
import { createTempFileCopy, cleanupTempFile, replaceFileSafely } from "./utils/file-operations";
import { getHistoryDatabaseCandidates } from "./utils/data-files";
import { findHeliumUserDataDir } from "./utils/browser";
import {
  CACHE_TTL_MS,
  DB_QUERY_TIMEOUT_MS,
  DB_MAX_BUFFER_BYTES,
  DB_BUSY_TIMEOUT_MS,
  DownloadState,
  DOWNLOAD_STATE_TEXT
} from "./utils/constants";

// Module-level cache
let cachedDownloads: DownloadItem[] | null = null;
let cacheTimestamp: number = 0;

interface DownloadItem {
  id: number;
  guid: string;
  fileName: string;
  currentPath: string;
  targetPath: string;
  sourceUrl: string;
  domain: string;
  startTime: number;
  startDate: Date;
  fileSize: number;
  receivedBytes: number;
  totalBytes: number;
  state: DownloadState;
  stateText: string;
  mimeType: string;
  referrer: string;
  fileExists: boolean;
  profileName: string;
}

/**
 * Find all History databases across profiles (downloads are in History DB)
 * Uses utility function with direct fallback for common installation paths
 */
async function findAllHistoryDatabases(): Promise<Array<{ path: string; profile: string }>> {
  const databases: Array<{ path: string; profile: string }> = [];

  // Strategy 1: Use utility function
  let userDataDir = await findHeliumUserDataDir();

  // Strategy 2: Direct fallback to common paths if utility fails
  if (!userDataDir) {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const commonPaths = [
        path.join(localAppData, "imput", "Helium", "User Data"),
        path.join(localAppData, "Helium", "User Data"),
      ];
      for (const candidate of commonPaths) {
        if (fs.existsSync(candidate)) {
          userDataDir = candidate;
          break;
        }
      }
    }
  }

  if (!userDataDir) {
    return databases;
  }

  const profiles = ["Default", "Profile 1", "Profile 2", "Guest Profile"];

  for (const profile of profiles) {
    const dbPath = path.join(userDataDir, profile, "History");
    if (fs.existsSync(dbPath)) {
      databases.push({ path: dbPath, profile });
    }
  }

  return databases;
}

/**
 * Find sqlite3.exe bundled with the extension
 * Uses absolute paths based on __dirname for reliable detection
 */
function getSqlite3Path(): string | null {
  // Try multiple path combinations relative to the built extension location
  const candidates = [
    path.join(__dirname, "..", "assets", "sqlite3.exe"),
    path.join(__dirname, "..", "bin", "sqlite3.exe"),
    path.join(__dirname, "assets", "sqlite3.exe"),
    path.join(__dirname, "bin", "sqlite3.exe"),
    path.join(__dirname, "..", "..", "assets", "sqlite3.exe"),
    path.join(__dirname, "..", "..", "bin", "sqlite3.exe"),
    path.join(process.cwd(), "assets", "sqlite3.exe"),
    path.join(process.cwd(), "bin", "sqlite3.exe"),
    path.resolve("assets", "sqlite3.exe"),
    path.resolve("bin", "sqlite3.exe"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Check if a file exists on disk
 */
function checkFileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Extract filename from path
 */
function getFileName(filePath: string): string {
  try {
    return path.basename(filePath);
  } catch {
    return filePath;
  }
}

/**
 * Load downloads from a specific History database
 */
async function loadDownloadsFromDatabase(dbPath: string, profileName: string): Promise<DownloadItem[]> {
  const sqlite3Path = getSqlite3Path();
  if (!sqlite3Path) {
    throw new Error("SQLite3 binary not found");
  }

  // Copy database to temp to avoid locks
  let tempDbPath: string | null = null;

  try {
    tempDbPath = await createTempFileCopy(dbPath, "downloads-");

    if (!tempDbPath) {
      throw new Error("Failed to create temporary copy of database (file may be locked by Helium browser)");
    }

    const query = `
      PRAGMA busy_timeout=${DB_BUSY_TIMEOUT_MS};
      SELECT
        d.id,
        d.guid,
        d.current_path,
        d.target_path,
        d.start_time,
        d.received_bytes,
        d.total_bytes,
        d.state,
        d.mime_type,
        d.referrer,
        duc.url as source_url
      FROM downloads d
      LEFT JOIN downloads_url_chains duc ON d.id = duc.id AND duc.chain_index = 0
      ORDER BY d.start_time DESC
      LIMIT 500;
    `;

    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn(sqlite3Path, ["-json", tempDbPath!, query], {
        timeout: DB_QUERY_TIMEOUT_MS,
        maxBuffer: DB_MAX_BUFFER_BYTES,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`SQLite query failed: ${stderr}`));
        }
      });

      proc.on("error", (err) => {
        reject(err);
      });
    });

    const rawResults = JSON.parse(result || "[]");

    return rawResults.map((row: any) => {
      const currentPath = row.current_path || row.target_path || "";
      const startDate = convertChromiumTimestamp(row.start_time || 0);
      const sourceUrl = row.source_url || row.referrer || "";

      return {
        id: row.id,
        guid: row.guid || "",
        fileName: getFileName(currentPath),
        currentPath: currentPath,
        targetPath: row.target_path || currentPath,
        sourceUrl: sourceUrl,
        domain: sourceUrl ? getDomain(sourceUrl) : "Unknown",
        startTime: row.start_time || 0,
        startDate: startDate,
        fileSize: row.total_bytes || row.received_bytes || 0,
        receivedBytes: row.received_bytes || 0,
        totalBytes: row.total_bytes || 0,
        state: row.state ?? DownloadState.COMPLETE,
        stateText: DOWNLOAD_STATE_TEXT[row.state ?? DownloadState.COMPLETE],
        mimeType: row.mime_type || "",
        referrer: row.referrer || "",
        fileExists: checkFileExists(currentPath),
        profileName: profileName,
      };
    });
  } finally {
    if (tempDbPath) {
      cleanupTempFile(tempDbPath);
    }
  }
}

/**
 * Load downloads from all profiles
 */
async function loadDownloads(): Promise<DownloadItem[]> {
  // Check cache
  const now = Date.now();
  if (cachedDownloads && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedDownloads;
  }

  const databases = await findAllHistoryDatabases();

  if (databases.length === 0) {
    throw new Error("No History database found. Please ensure Helium browser is installed.");
  }

  const allDownloads: DownloadItem[] = [];

  for (const { path: dbPath, profile } of databases) {
    try {
      const downloads = await loadDownloadsFromDatabase(dbPath, profile);
      allDownloads.push(...downloads);
    } catch (error) {
      // Skip this profile if it fails, continue with others
      console.error(`Failed to load downloads from ${profile}:`, error);
    }
  }

  // Sort all downloads by start time descending (newest first)
  allDownloads.sort((a, b) => b.startTime - a.startTime);

  // Update cache
  cachedDownloads = allDownloads;
  cacheTimestamp = now;

  return allDownloads;
}

/**
 * Clear the downloads cache
 */
function clearDownloadsCache(): void {
  cachedDownloads = null;
  cacheTimestamp = 0;
}

/**
 * Delete a download entry from the database
 */
async function deleteDownloadEntry(downloadItem: DownloadItem): Promise<void> {
  const databases = await findAllHistoryDatabases();
  const targetDb = databases.find((db) => db.profile === downloadItem.profileName);

  if (!targetDb) {
    throw new Error(`Database for profile "${downloadItem.profileName}" not found`);
  }

  const sqlite3Path = getSqlite3Path();
  if (!sqlite3Path) {
    throw new Error("SQLite3 binary not found");
  }

  let tempDbPath: string | null = null;

  try {
    // Copy database to temp
    tempDbPath = await createTempFileCopy(targetDb.path, "downloads-delete-");

    if (!tempDbPath) {
      throw new Error("Failed to create temporary copy of database (file may be locked by Helium browser)");
    }

    // Execute delete transaction
    const deleteQuery = `
      PRAGMA busy_timeout=${DB_BUSY_TIMEOUT_MS};
      BEGIN IMMEDIATE TRANSACTION;
      DELETE FROM downloads WHERE id = ${downloadItem.id};
      DELETE FROM downloads_url_chains WHERE id = ${downloadItem.id};
      COMMIT;
    `;

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(sqlite3Path, [tempDbPath!, deleteQuery], {
        timeout: DB_QUERY_TIMEOUT_MS,
      });

      let stderr = "";

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Delete failed: ${stderr}`));
        }
      });

      proc.on("error", (err) => {
        reject(err);
      });
    });

    // Replace original database with modified version
    await replaceFileSafely(tempDbPath, targetDb.path);

    // Clear cache
    clearDownloadsCache();
  } finally {
    if (tempDbPath) {
      cleanupTempFile(tempDbPath);
    }
  }
}

/**
 * Delete multiple download entries
 */
async function deleteMultipleDownloadEntries(downloadItems: DownloadItem[]): Promise<void> {
  // Group by profile
  const byProfile = new Map<string, DownloadItem[]>();

  for (const item of downloadItems) {
    const items = byProfile.get(item.profileName) || [];
    items.push(item);
    byProfile.set(item.profileName, items);
  }

  // Delete from each profile database
  for (const [profileName, items] of byProfile) {
    const databases = await findAllHistoryDatabases();
    const targetDb = databases.find((db) => db.profile === profileName);

    if (!targetDb) {
      console.error(`Database for profile "${profileName}" not found`);
      continue;
    }

    const sqlite3Path = getSqlite3Path();
    if (!sqlite3Path) {
      throw new Error("SQLite3 binary not found");
    }

    let tempDbPath: string | null = null;

    try {
      tempDbPath = await createTempFileCopy(targetDb.path, "downloads-bulk-delete-");

      if (!tempDbPath) {
        throw new Error("Failed to create temporary copy of database (file may be locked by Helium browser)");
      }

      const deleteStatements = items
        .map((item) => `DELETE FROM downloads WHERE id = ${item.id}; DELETE FROM downloads_url_chains WHERE id = ${item.id};`)
        .join("\n");

      const deleteQuery = `
        PRAGMA busy_timeout=${DB_BUSY_TIMEOUT_MS};
        BEGIN IMMEDIATE TRANSACTION;
        ${deleteStatements}
        COMMIT;
      `;

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(sqlite3Path, [tempDbPath!, deleteQuery], {
          timeout: DB_QUERY_TIMEOUT_MS,
        });

        let stderr = "";

        proc.stderr?.on("data", (data) => {
          stderr += data.toString();
        });

        proc.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Bulk delete failed: ${stderr}`));
          }
        });

        proc.on("error", (err) => {
          reject(err);
        });
      });

      await replaceFileSafely(tempDbPath, targetDb.path);
    } finally {
      if (tempDbPath) {
        cleanupTempFile(tempDbPath);
      }
    }
  }

  clearDownloadsCache();
}

enum ViewMode {
  NORMAL = "normal",
  SELECTION = "selection",
}

/**
 * Main command component
 */
export default function SearchDownloads() {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.NORMAL);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

  // Load downloads
  useEffect(() => {
    async function fetchDownloads() {
      setIsLoading(true);
      setError(null);

      try {
        const items = await loadDownloads();
        setDownloads(items);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        showToast({
          style: Toast.Style.Failure,
          title: "Failed to load downloads",
          message: errorMessage,
        });
      } finally {
        setIsLoading(false);
      }
    }

    fetchDownloads();
  }, []);

  // Filter downloads based on search
  const filteredDownloads = downloads.filter((item) => {
    if (!searchText) return true;
    const query = searchText.toLowerCase();
    return (
      item.fileName.toLowerCase().includes(query) ||
      item.domain.toLowerCase().includes(query) ||
      item.sourceUrl.toLowerCase().includes(query) ||
      item.currentPath.toLowerCase().includes(query)
    );
  });

  // Toggle selection
  const toggleSelection = useCallback((id: number) => {
    setSelectedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  // Enter selection mode and select current item
  const enterSelectionMode = useCallback((id: number) => {
    setViewMode(ViewMode.SELECTION);
    setSelectedItems(new Set([id]));
  }, []);

  // Exit selection mode
  const exitSelectionMode = useCallback(() => {
    setViewMode(ViewMode.NORMAL);
    setSelectedItems(new Set());
  }, []);

  // Handle delete
  const handleDelete = useCallback(
    async (download: DownloadItem) => {
      const confirmed = await confirmAlert({
        title: "Clear Download Entry",
        message: `Are you sure you want to clear the download entry for "${download.fileName}"? This will not delete the file from disk.`,
        primaryAction: {
          title: "Clear Entry",
          style: Alert.ActionStyle.Destructive,
        },
      });

      if (!confirmed) return;

      try {
        await deleteDownloadEntry(download);
        await showHUD("Download entry cleared");

        // Reload downloads
        const items = await loadDownloads();
        setDownloads(items);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        showToast({
          style: Toast.Style.Failure,
          title: "Failed to clear download",
          message: errorMessage,
        });
      }
    },
    []
  );

  // Handle bulk delete
  const handleBulkDelete = useCallback(async () => {
    if (selectedItems.size === 0) return;

    const itemsToDelete = downloads.filter((d) => selectedItems.has(d.id));

    const confirmed = await confirmAlert({
      title: `Clear ${selectedItems.size} Download Entries`,
      message: `Are you sure you want to clear ${selectedItems.size} download entries? This will not delete the files from disk.`,
      primaryAction: {
        title: `Clear ${selectedItems.size} Entries`,
        style: Alert.ActionStyle.Destructive,
      },
    });

    if (!confirmed) return;

    try {
      await deleteMultipleDownloadEntries(itemsToDelete);
      await showHUD(`${selectedItems.size} download entries cleared`);

      // Exit selection mode and reload
      exitSelectionMode();
      const items = await loadDownloads();
      setDownloads(items);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to clear downloads",
        message: errorMessage,
      });
    }
  }, [selectedItems, downloads, exitSelectionMode]);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder={
        viewMode === ViewMode.SELECTION
          ? `${selectedItems.size} selected - Search downloads...`
          : "Search downloads by filename, domain, or URL..."
      }
      onSearchTextChange={setSearchText}
      throttle
      isShowingDetail={viewMode === ViewMode.NORMAL}
      searchBarAccessory={
        <List.Dropdown tooltip="View Mode" value={viewMode} onChange={(value) => {
          setViewMode(value as ViewMode);
          if (value === ViewMode.NORMAL) {
            setSelectedItems(new Set());
          }
        }}>
          <List.Dropdown.Item title="Normal Mode" value={ViewMode.NORMAL} />
          <List.Dropdown.Item title="Selection Mode" value={ViewMode.SELECTION} />
        </List.Dropdown>
      }
    >
      {error ? (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Error Loading Downloads"
          description={error}
        />
      ) : filteredDownloads.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Download}
          title={searchText ? "No Downloads Found" : "No Downloads"}
          description={searchText ? "Try a different search query" : "Your download history is empty"}
        />
      ) : (
        filteredDownloads.map((download) => (
          <List.Item
            key={`${download.profileName}-${download.id}`}
            title={
              viewMode === ViewMode.SELECTION && selectedItems.has(download.id)
                ? `✓ ${download.fileName}`
                : download.fileName
            }
            icon={download.fileExists ? Icon.Document : Icon.ExclamationMark}
            accessories={
              viewMode === ViewMode.NORMAL
                ? [
                    ...(download.profileName !== "Default"
                      ? [{ tag: download.profileName }]
                      : []),
                    { text: formatFileSize(download.fileSize) },
                    { text: formatDate(download.startDate) },
                    ...(!download.fileExists ? [{ icon: Icon.ExclamationMark, tooltip: "File not found" }] : []),
                    ...(download.state !== DownloadState.COMPLETE
                      ? [{ tag: download.stateText }]
                      : []),
                  ]
                : [
                    ...(selectedItems.has(download.id) ? [{ icon: Icon.Checkmark }] : []),
                  ]
            }
            detail={
              <List.Item.Detail
                markdown={`# ${download.fileName}\n\n${download.sourceUrl ? `![](${getFaviconUrl(download.sourceUrl)})` : ""}`}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label
                      title="File Path"
                      text={download.currentPath}
                    />
                    <List.Item.Detail.Metadata.Link
                      title="Source URL"
                      text={download.sourceUrl || "Unknown"}
                      target={download.sourceUrl}
                    />
                    <List.Item.Detail.Metadata.Label title="Domain" text={download.domain} />
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.Label
                      title="File Size"
                      text={formatFileSize(download.fileSize)}
                    />
                    <List.Item.Detail.Metadata.Label
                      title="Downloaded"
                      text={formatAbsoluteDate(download.startDate)}
                    />
                    <List.Item.Detail.Metadata.Label title="Status" text={download.stateText} />
                    {download.profileName !== "Default" && (
                      <List.Item.Detail.Metadata.Label title="Profile" text={download.profileName} />
                    )}
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.Label
                      title="File Exists"
                      text={download.fileExists ? "Yes" : "No"}
                      icon={download.fileExists ? Icon.Checkmark : Icon.ExclamationMark}
                    />
                    {download.mimeType && (
                      <List.Item.Detail.Metadata.Label title="MIME Type" text={download.mimeType} />
                    )}
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              viewMode === ViewMode.NORMAL ? (
                <ActionPanel>
                  <Action
                    title="Open File"
                    icon={Icon.Finder}
                    shortcut={{ modifiers: [], key: "return" }}
                    onAction={async () => {
                      const success = await openFileDirectly(download.currentPath);
                      if (!success) {
                        showToast({
                          style: Toast.Style.Failure,
                          title: "File Not Found",
                          message: "The downloaded file no longer exists",
                        });
                      }
                    }}
                  />
                  <Action
                    title="Show in Folder"
                    icon={Icon.Folder}
                    shortcut={{ modifiers: ["cmd"], key: "o" }}
                    onAction={async () => {
                      const success = await openFileInExplorer(download.currentPath);
                      if (!success) {
                        showToast({
                          style: Toast.Style.Failure,
                          title: "File Not Found",
                          message: "The downloaded file no longer exists",
                        });
                      }
                    }}
                  />
                  <Action
                    title="Copy File Path"
                    icon={Icon.Clipboard}
                    shortcut={{ modifiers: ["cmd"], key: "c" }}
                    onAction={async () => {
                      await Clipboard.copy(download.currentPath);
                      await showHUD("File path copied to clipboard");
                    }}
                  />
                  <Action
                    title="Copy Source URL"
                    icon={Icon.Link}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                    onAction={async () => {
                      await Clipboard.copy(download.sourceUrl);
                      await showHUD("Source URL copied to clipboard");
                    }}
                  />
                  {download.sourceUrl && (
                    <Action
                      title="Open Source URL"
                      icon={Icon.Globe}
                      onAction={async () => {
                        const heliumPath = await findHeliumPath();
                        if (heliumPath) {
                          await launchUrlInBrowser(heliumPath, download.sourceUrl);
                        } else {
                          showToast({
                            style: Toast.Style.Failure,
                            title: "Helium Not Found",
                            message: "Could not find Helium browser",
                          });
                        }
                      }}
                    />
                  )}
                  <Action
                    title="Clear Download Entry"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["cmd"], key: "backspace" }}
                    onAction={() => handleDelete(download)}
                  />
                  <Action
                    title="Select Multiple"
                    icon={Icon.Checkmark}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
                    onAction={() => enterSelectionMode(download.id)}
                  />
                </ActionPanel>
              ) : (
                <ActionPanel>
                  <Action
                    title={selectedItems.has(download.id) ? "Deselect" : "Select"}
                    icon={selectedItems.has(download.id) ? Icon.Circle : Icon.Checkmark}
                    shortcut={{ modifiers: ["cmd"], key: "s" }}
                    onAction={() => toggleSelection(download.id)}
                  />
                  {selectedItems.size > 0 && (
                    <Action
                      title={`Clear ${selectedItems.size} Selected Entries`}
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      shortcut={{ modifiers: ["cmd"], key: "backspace" }}
                      onAction={handleBulkDelete}
                    />
                  )}
                  <Action
                    title="Exit Selection Mode"
                    icon={Icon.XMarkCircle}
                    shortcut={{ modifiers: [], key: "escape" }}
                    onAction={exitSelectionMode}
                  />
                </ActionPanel>
              )
            }
          />
        ))
      )}
    </List>
  );
}
