/**
 * Search Cookies - Helium Browser Controller
 * View, search, and manage browser cookies across all profiles
 * @author Just_Me
 */

import { List, showToast, Toast, Action, ActionPanel, Icon, showHUD, confirmAlert, Alert, Clipboard } from "@raycast/api";
import { useState, useEffect, useCallback } from "react";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Utility imports
import { findAllCookiesDatabases } from "./utils/data-files";
import { convertChromiumTimestamp, formatCookieExpiry, truncateCookieValue, formatSameSite, formatAbsoluteDate, formatDate } from "./utils/formatters";
import { createTempFileCopy, cleanupTempFile, replaceFileSafely } from "./utils/file-operations";
import {
  CACHE_TTL_MS,
  DB_QUERY_TIMEOUT_MS,
  DB_MAX_BUFFER_BYTES,
  DB_BUSY_TIMEOUT_MS,
  MAX_COOKIE_VALUE_PREVIEW_LENGTH,
  SameSiteValue
} from "./utils/constants";

// Module-level cache (metadata only, NO cookie values)
let cachedCookies: CookieItem[] | null = null;
let cacheTimestamp: number = 0;

interface CookieItem {
  id: string; // Composite: hostKey + name + creationUtc + profileName
  hostKey: string; // Domain with leading dot (e.g., ".github.com")
  domain: string; // Cleaned domain (e.g., "github.com")
  name: string;
  value: string; // Unencrypted value or "[ENCRYPTED]"
  valuePreview: string; // Truncated to 50 chars
  isEncrypted: boolean;
  path: string;
  creationUtc: number;
  creationDate: Date;
  expiresUtc: number;
  expiresDate: Date | null; // null for session cookies
  expiryText: string; // "Session" or "Expires in 7 days"
  isSecure: boolean;
  isHttpOnly: boolean;
  lastAccessUtc: number;
  lastAccessDate: Date;
  hasExpires: boolean;
  isPersistent: boolean;
  sameSite: SameSiteValue;
  sameSiteText: string;
  isSessionCookie: boolean;
  profileName: string;
}

/**
 * Find sqlite3.exe bundled with the extension
 */
function getSqlite3Path(): string | null {
  const candidates = [
    "assets/bin/sqlite3.exe",
    "assets/sqlite3.exe",
    "bin/sqlite3.exe",
    "sqlite3.exe",
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Clean domain by removing leading dot
 */
function cleanDomain(hostKey: string): string {
  return hostKey.startsWith(".") ? hostKey.substring(1) : hostKey;
}

/**
 * Extract cookie value, handling encryption
 * Returns "[ENCRYPTED]" for encrypted cookies (no DPAPI decryption)
 */
function getCookieValue(value: string, encryptedValue: Buffer | null): string {
  // If value field is populated, use it (unencrypted)
  if (value && value.trim()) {
    return value;
  }

  // If encrypted_value exists, check for encryption markers
  if (encryptedValue && encryptedValue.length > 0) {
    const prefix = encryptedValue.slice(0, 3).toString("ascii");
    if (prefix === "v10" || prefix === "v11") {
      return "[ENCRYPTED]";
    }
  }

  return "";
}

/**
 * Load cookies from a specific Cookies database
 */
async function loadCookiesFromDatabase(dbPath: string, profileName: string): Promise<CookieItem[]> {
  const sqlite3Path = getSqlite3Path();
  if (!sqlite3Path) {
    throw new Error("SQLite3 binary not found");
  }

  // Copy database to temp to avoid locks
  let tempDbPath: string | null = null;

  try {
    tempDbPath = await createTempFileCopy(dbPath, "cookies-");

    if (!tempDbPath) {
      throw new Error("Failed to create temporary copy of database (file may be locked by Helium browser)");
    }

    const query = `
      PRAGMA busy_timeout=${DB_BUSY_TIMEOUT_MS};
      SELECT
        creation_utc,
        host_key,
        name,
        value,
        encrypted_value,
        path,
        expires_utc,
        is_secure,
        is_httponly,
        last_access_utc,
        has_expires,
        is_persistent,
        samesite
      FROM cookies
      ORDER BY host_key ASC, name ASC
      LIMIT 1000;
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
      const hostKey = row.host_key || "";
      const domain = cleanDomain(hostKey);
      const creationDate = convertChromiumTimestamp(row.creation_utc || 0);
      const expiresUtc = row.expires_utc || 0;
      const hasExpires = Boolean(row.has_expires);
      const expiresDate = hasExpires && expiresUtc > 0 ? convertChromiumTimestamp(expiresUtc) : null;
      const lastAccessDate = convertChromiumTimestamp(row.last_access_utc || 0);
      const sameSite = row.samesite ?? -1;

      // Handle encrypted_value as Buffer (SQLite BLOB)
      const encryptedValue = row.encrypted_value ? Buffer.from(row.encrypted_value, "base64") : null;
      const cookieValue = getCookieValue(row.value || "", encryptedValue);
      const isEncrypted = cookieValue === "[ENCRYPTED]";

      const id = `${hostKey}:${row.name}:${row.creation_utc}:${profileName}`;

      return {
        id,
        hostKey,
        domain,
        name: row.name || "",
        value: cookieValue,
        valuePreview: truncateCookieValue(cookieValue, MAX_COOKIE_VALUE_PREVIEW_LENGTH),
        isEncrypted,
        path: row.path || "/",
        creationUtc: row.creation_utc || 0,
        creationDate,
        expiresUtc,
        expiresDate,
        expiryText: formatCookieExpiry(expiresUtc, hasExpires),
        isSecure: Boolean(row.is_secure),
        isHttpOnly: Boolean(row.is_httponly),
        lastAccessUtc: row.last_access_utc || 0,
        lastAccessDate,
        hasExpires,
        isPersistent: Boolean(row.is_persistent),
        sameSite,
        sameSiteText: formatSameSite(sameSite),
        isSessionCookie: !hasExpires || expiresUtc === 0,
        profileName,
      };
    });
  } finally {
    if (tempDbPath) {
      cleanupTempFile(tempDbPath);
    }
  }
}

/**
 * Load cookies from all profiles
 */
async function loadCookies(): Promise<CookieItem[]> {
  // Check cache
  const now = Date.now();
  if (cachedCookies && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedCookies;
  }

  const databases = await findAllCookiesDatabases();

  if (databases.length === 0) {
    throw new Error("No Cookies database found. Please ensure Helium browser is installed.");
  }

  const allCookies: CookieItem[] = [];

  for (const { path: dbPath, profile } of databases) {
    try {
      const cookies = await loadCookiesFromDatabase(dbPath, profile);
      allCookies.push(...cookies);
    } catch (error) {
      // Skip this profile if it fails, continue with others
      console.error(`Failed to load cookies from ${profile}:`, error);
    }
  }

  // Sort all cookies by domain + name
  allCookies.sort((a, b) => {
    const domainCompare = a.domain.localeCompare(b.domain);
    if (domainCompare !== 0) return domainCompare;
    return a.name.localeCompare(b.name);
  });

  // Update cache (metadata only, values are part of items but NOT separately cached)
  cachedCookies = allCookies;
  cacheTimestamp = now;

  return allCookies;
}

/**
 * Clear the cookies cache
 */
function clearCookiesCache(): void {
  cachedCookies = null;
  cacheTimestamp = 0;
}

/**
 * Delete a single cookie from the database
 */
async function deleteCookie(cookie: CookieItem): Promise<void> {
  const databases = await findAllCookiesDatabases();
  const targetDb = databases.find((db) => db.profile === cookie.profileName);

  if (!targetDb) {
    throw new Error(`Database for profile "${cookie.profileName}" not found`);
  }

  const sqlite3Path = getSqlite3Path();
  if (!sqlite3Path) {
    throw new Error("SQLite3 binary not found");
  }

  let tempDbPath: string | null = null;

  try {
    tempDbPath = await createTempFileCopy(targetDb.path, "cookies-delete-");

    if (!tempDbPath) {
      throw new Error("Failed to create temporary copy of database (file may be locked by Helium browser)");
    }

    const deleteQuery = `
      PRAGMA busy_timeout=${DB_BUSY_TIMEOUT_MS};
      BEGIN IMMEDIATE TRANSACTION;
      DELETE FROM cookies WHERE host_key = '${cookie.hostKey.replace(/'/g, "''")}' AND name = '${cookie.name.replace(/'/g, "''")}' AND creation_utc = ${cookie.creationUtc};
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

    await replaceFileSafely(tempDbPath, targetDb.path);
    clearCookiesCache();
  } finally {
    if (tempDbPath) {
      cleanupTempFile(tempDbPath);
    }
  }
}

/**
 * Delete all cookies for a specific domain
 */
async function deleteAllCookiesForDomain(cookie: CookieItem): Promise<number> {
  const databases = await findAllCookiesDatabases();
  const targetDb = databases.find((db) => db.profile === cookie.profileName);

  if (!targetDb) {
    throw new Error(`Database for profile "${cookie.profileName}" not found`);
  }

  const sqlite3Path = getSqlite3Path();
  if (!sqlite3Path) {
    throw new Error("SQLite3 binary not found");
  }

  let tempDbPath: string | null = null;

  try {
    tempDbPath = await createTempFileCopy(targetDb.path, "cookies-domain-delete-");

    if (!tempDbPath) {
      throw new Error("Failed to create temporary copy of database (file may be locked by Helium browser)");
    }

    // Count first
    const countQuery = `
      SELECT COUNT(*) as count FROM cookies WHERE host_key = '${cookie.hostKey.replace(/'/g, "''")}' OR host_key = '${cleanDomain(cookie.hostKey).replace(/'/g, "''")}';
    `;

    const countResult = await new Promise<string>((resolve, reject) => {
      const proc = spawn(sqlite3Path, ["-json", tempDbPath!, countQuery], {
        timeout: DB_QUERY_TIMEOUT_MS,
      });

      let stdout = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.on("close", () => {
        resolve(stdout);
      });

      proc.on("error", (err) => {
        reject(err);
      });
    });

    const countData = JSON.parse(countResult || "[{\"count\": 0}]");
    const count = countData[0]?.count || 0;

    // Delete
    const deleteQuery = `
      PRAGMA busy_timeout=${DB_BUSY_TIMEOUT_MS};
      BEGIN IMMEDIATE TRANSACTION;
      DELETE FROM cookies WHERE host_key = '${cookie.hostKey.replace(/'/g, "''")}' OR host_key = '${cleanDomain(cookie.hostKey).replace(/'/g, "''")}';
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

    await replaceFileSafely(tempDbPath, targetDb.path);
    clearCookiesCache();

    return count;
  } finally {
    if (tempDbPath) {
      cleanupTempFile(tempDbPath);
    }
  }
}

/**
 * Delete multiple cookies
 */
async function deleteMultipleCookies(cookies: CookieItem[]): Promise<void> {
  // Group by profile
  const byProfile = new Map<string, CookieItem[]>();

  for (const cookie of cookies) {
    const items = byProfile.get(cookie.profileName) || [];
    items.push(cookie);
    byProfile.set(cookie.profileName, items);
  }

  // Delete from each profile database
  for (const [profileName, items] of byProfile) {
    const databases = await findAllCookiesDatabases();
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
      tempDbPath = await createTempFileCopy(targetDb.path, "cookies-bulk-delete-");

      if (!tempDbPath) {
        throw new Error("Failed to create temporary copy of database (file may be locked by Helium browser)");
      }

      const deleteStatements = items
        .map((cookie) => `DELETE FROM cookies WHERE host_key = '${cookie.hostKey.replace(/'/g, "''")}' AND name = '${cookie.name.replace(/'/g, "''")}' AND creation_utc = ${cookie.creationUtc};`)
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

  clearCookiesCache();
}

enum ViewMode {
  NORMAL = "normal",
  SELECTION = "selection",
}

/**
 * Main command component
 */
export default function SearchCookies() {
  const [cookies, setCookies] = useState<CookieItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.NORMAL);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // Load cookies
  useEffect(() => {
    async function fetchCookies() {
      setIsLoading(true);
      setError(null);

      try {
        const items = await loadCookies();
        setCookies(items);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        showToast({
          style: Toast.Style.Failure,
          title: "Failed to load cookies",
          message: errorMessage,
        });
      } finally {
        setIsLoading(false);
      }
    }

    fetchCookies();
  }, []);

  // Filter cookies based on search
  const filteredCookies = cookies.filter((item) => {
    if (!searchText) return true;
    const query = searchText.toLowerCase();
    return (
      item.domain.toLowerCase().includes(query) ||
      item.name.toLowerCase().includes(query) ||
      item.value.toLowerCase().includes(query) ||
      item.hostKey.toLowerCase().includes(query)
    );
  });

  // Toggle selection
  const toggleSelection = useCallback((id: string) => {
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
  const enterSelectionMode = useCallback((id: string) => {
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
    async (cookie: CookieItem) => {
      const confirmed = await confirmAlert({
        title: "Delete Cookie",
        message: `Are you sure you want to delete the cookie "${cookie.name}" for ${cookie.domain}?`,
        primaryAction: {
          title: "Delete",
          style: Alert.ActionStyle.Destructive,
        },
      });

      if (!confirmed) return;

      try {
        await deleteCookie(cookie);
        await showHUD("Cookie deleted");

        // Reload cookies
        const items = await loadCookies();
        setCookies(items);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        showToast({
          style: Toast.Style.Failure,
          title: "Failed to delete cookie",
          message: errorMessage,
        });
      }
    },
    []
  );

  // Handle domain delete
  const handleDomainDelete = useCallback(
    async (cookie: CookieItem) => {
      try {
        const count = await deleteAllCookiesForDomain(cookie);

        const confirmed = await confirmAlert({
          title: `Delete ${count} Cookies`,
          message: `Are you sure you want to delete all ${count} cookies for ${cookie.domain}?`,
          primaryAction: {
            title: `Delete ${count} Cookies`,
            style: Alert.ActionStyle.Destructive,
          },
        });

        if (!confirmed) return;

        await deleteAllCookiesForDomain(cookie);
        await showHUD(`${count} cookies deleted`);

        // Reload cookies
        const items = await loadCookies();
        setCookies(items);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        showToast({
          style: Toast.Style.Failure,
          title: "Failed to delete cookies",
          message: errorMessage,
        });
      }
    },
    []
  );

  // Handle bulk delete
  const handleBulkDelete = useCallback(async () => {
    if (selectedItems.size === 0) return;

    const itemsToDelete = cookies.filter((c) => selectedItems.has(c.id));

    const confirmed = await confirmAlert({
      title: `Delete ${selectedItems.size} Cookies`,
      message: `Are you sure you want to delete ${selectedItems.size} cookies?`,
      primaryAction: {
        title: `Delete ${selectedItems.size} Cookies`,
        style: Alert.ActionStyle.Destructive,
      },
    });

    if (!confirmed) return;

    try {
      await deleteMultipleCookies(itemsToDelete);
      await showHUD(`${selectedItems.size} cookies deleted`);

      // Exit selection mode and reload
      exitSelectionMode();
      const items = await loadCookies();
      setCookies(items);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to delete cookies",
        message: errorMessage,
      });
    }
  }, [selectedItems, cookies, exitSelectionMode]);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder={
        viewMode === ViewMode.SELECTION
          ? `${selectedItems.size} selected - Search cookies...`
          : "Search cookies by domain, name, or value..."
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
          title="Error Loading Cookies"
          description={error}
        />
      ) : filteredCookies.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Lock}
          title={searchText ? "No Cookies Found" : "No Cookies"}
          description={searchText ? "Try a different search query" : "No browser cookies available"}
        />
      ) : (
        filteredCookies.map((cookie) => (
          <List.Item
            key={cookie.id}
            title={
              viewMode === ViewMode.SELECTION && selectedItems.has(cookie.id)
                ? `✓ ${cookie.domain}: ${cookie.name}`
                : `${cookie.domain}: ${cookie.name}`
            }
            subtitle={viewMode === ViewMode.NORMAL ? cookie.valuePreview : undefined}
            icon={cookie.isSecure ? Icon.Lock : Icon.Document}
            accessories={
              viewMode === ViewMode.NORMAL
                ? [
                    ...(cookie.profileName !== "Default"
                      ? [{ tag: cookie.profileName }]
                      : []),
                    { text: cookie.expiryText },
                    ...(cookie.isEncrypted ? [{ icon: Icon.Eye, tooltip: "Encrypted" }] : []),
                  ]
                : [
                    ...(selectedItems.has(cookie.id) ? [{ icon: Icon.Checkmark }] : []),
                  ]
            }
            detail={
              <List.Item.Detail
                markdown={`# ${cookie.name}\n\n**Domain:** ${cookie.domain}`}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="Domain" text={cookie.domain} />
                    <List.Item.Detail.Metadata.Label title="Cookie Name" text={cookie.name} />
                    <List.Item.Detail.Metadata.Label
                      title="Value"
                      text={cookie.isEncrypted ? "[ENCRYPTED]" : cookie.value}
                    />
                    <List.Item.Detail.Metadata.Label title="Path" text={cookie.path} />
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.Label
                      title="Created"
                      text={formatAbsoluteDate(cookie.creationDate)}
                    />
                    <List.Item.Detail.Metadata.Label
                      title="Expires"
                      text={cookie.isSessionCookie ? "Session Cookie" : formatAbsoluteDate(cookie.expiresDate!)}
                    />
                    <List.Item.Detail.Metadata.Label
                      title="Last Accessed"
                      text={formatDate(cookie.lastAccessDate)}
                    />
                    {cookie.profileName !== "Default" && (
                      <List.Item.Detail.Metadata.Label title="Profile" text={cookie.profileName} />
                    )}
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.Label
                      title="Secure"
                      text={cookie.isSecure ? "Yes" : "No"}
                      icon={cookie.isSecure ? Icon.Checkmark : Icon.XMarkCircle}
                    />
                    <List.Item.Detail.Metadata.Label
                      title="HttpOnly"
                      text={cookie.isHttpOnly ? "Yes" : "No"}
                      icon={cookie.isHttpOnly ? Icon.Checkmark : Icon.XMarkCircle}
                    />
                    <List.Item.Detail.Metadata.Label
                      title="SameSite"
                      text={cookie.sameSiteText}
                    />
                    <List.Item.Detail.Metadata.Label
                      title="Type"
                      text={cookie.isSessionCookie ? "Session" : "Persistent"}
                    />
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              viewMode === ViewMode.NORMAL ? (
                <ActionPanel>
                  <Action
                    title="Copy Cookie Value"
                    icon={Icon.Clipboard}
                    shortcut={{ modifiers: [], key: "return" }}
                    onAction={async () => {
                      if (cookie.isEncrypted) {
                        showToast({
                          style: Toast.Style.Failure,
                          title: "Cannot Copy Encrypted Value",
                          message: "This cookie value is encrypted by the browser",
                        });
                      } else {
                        await Clipboard.copy(cookie.value);
                        await showHUD("Cookie value copied to clipboard");
                      }
                    }}
                  />
                  <Action
                    title="Copy Cookie Name"
                    icon={Icon.Clipboard}
                    shortcut={{ modifiers: ["cmd"], key: "c" }}
                    onAction={async () => {
                      await Clipboard.copy(cookie.name);
                      await showHUD("Cookie name copied to clipboard");
                    }}
                  />
                  <Action
                    title="Copy Domain"
                    icon={Icon.Link}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                    onAction={async () => {
                      await Clipboard.copy(cookie.domain);
                      await showHUD("Domain copied to clipboard");
                    }}
                  />
                  <Action
                    title="Delete Cookie"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["cmd"], key: "backspace" }}
                    onAction={() => handleDelete(cookie)}
                  />
                  <Action
                    title="Delete All Cookies for Domain"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    onAction={() => handleDomainDelete(cookie)}
                  />
                  <Action
                    title="Select Multiple"
                    icon={Icon.Checkmark}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
                    onAction={() => enterSelectionMode(cookie.id)}
                  />
                </ActionPanel>
              ) : (
                <ActionPanel>
                  <Action
                    title={selectedItems.has(cookie.id) ? "Deselect" : "Select"}
                    icon={selectedItems.has(cookie.id) ? Icon.Circle : Icon.Checkmark}
                    shortcut={{ modifiers: ["cmd"], key: "s" }}
                    onAction={() => toggleSelection(cookie.id)}
                  />
                  {selectedItems.size > 0 && (
                    <Action
                      title={`Delete ${selectedItems.size} Selected Cookies`}
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
