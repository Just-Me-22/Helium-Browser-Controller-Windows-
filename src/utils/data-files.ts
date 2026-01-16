/**
 * Data file location utilities for Helium browser
 * Centralizes finding bookmarks and history database files
 */

import * as path from "path";
import * as fs from "fs";
import { findHeliumUserDataDir } from "./browser";
import { HELIUM_DATA_PATHS } from "./constants";

function getProfileCandidates(userDataDir: string): string[] {
  try {
    const entries = fs.readdirSync(userDataDir, { withFileTypes: true });
    const profiles = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => name === "Default" || name === "Guest Profile" || /^Profile \d+$/.test(name));

    if (profiles.length > 0) {
      const defaultFirst = profiles.filter((p) => p === "Default");
      const numberedProfiles = profiles
        .filter((p) => p.startsWith("Profile "))
        .sort((a, b) => parseInt(a.replace("Profile ", ""), 10) - parseInt(b.replace("Profile ", ""), 10));
      const guest = profiles.filter((p) => p === "Guest Profile");
      const other = profiles.filter((p) => !defaultFirst.includes(p) && !numberedProfiles.includes(p) && !guest.includes(p));

      return [...defaultFirst, ...numberedProfiles, ...guest, ...other];
    }
  } catch {
    // Ignore directory enumeration errors, fall back to common profile names.
  }

  return ["Default", "Profile 1", "Profile 2", "Profile 3", "Guest Profile"];
}

/**
 * Get all candidate paths where bookmarks file might exist
 */
export function getBookmarksFileCandidates(userDataDir: string): string[] {
  const candidates: string[] = [];

  // Default profile
  candidates.push(
    path.join(userDataDir, HELIUM_DATA_PATHS.PROFILE_DEFAULT, HELIUM_DATA_PATHS.BOOKMARKS_FILE)
  );

  // Common alternative profiles
  const commonProfiles = ["Profile 1", "Profile 2", "Guest Profile", "Default"];
  for (const profile of commonProfiles) {
    candidates.push(path.join(userDataDir, profile, HELIUM_DATA_PATHS.BOOKMARKS_FILE));
  }

  // Root-level bookmarks (some versions)
  candidates.push(path.join(userDataDir, HELIUM_DATA_PATHS.BOOKMARKS_FILE));

  return candidates;
}

/**
 * Find bookmarks file in Helium User Data directory
 * Tries multiple profiles and locations
 */
export async function findBookmarksFile(): Promise<string | null> {
  const userDataDir = await findHeliumUserDataDir();
  if (!userDataDir) {
    return null;
  }

  const candidates = getBookmarksFileCandidates(userDataDir);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Get all candidate paths where history database might exist
 */
export function getHistoryDatabaseCandidates(userDataDir: string): string[] {
  const candidates: string[] = [];

  // Default profile
  candidates.push(path.join(userDataDir, HELIUM_DATA_PATHS.PROFILE_DEFAULT, HELIUM_DATA_PATHS.HISTORY_FILE));

  // Common alternative profiles
  const commonProfiles = ["Profile 1", "Profile 2", "Guest Profile", "Default"];
  for (const profile of commonProfiles) {
    candidates.push(path.join(userDataDir, profile, HELIUM_DATA_PATHS.HISTORY_FILE));
  }

  // Root-level history (some versions)
  candidates.push(path.join(userDataDir, HELIUM_DATA_PATHS.HISTORY_FILE));

  return candidates;
}

/**
 * Find history database in Helium User Data directory
 * Tries multiple profiles and locations
 */
export async function findHistoryDatabase(): Promise<string | null> {
  const userDataDir = await findHeliumUserDataDir();
  if (!userDataDir) {
    return null;
  }

  const candidates = getHistoryDatabaseCandidates(userDataDir);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Check if a bookmarks file path is valid and readable
 */
export function isValidBookmarksFile(filePath: string): boolean {
  return fs.existsSync(filePath) && filePath.endsWith(HELIUM_DATA_PATHS.BOOKMARKS_FILE);
}

/**
 * Check if a history database path is valid and readable
 */
export function isValidHistoryDatabase(filePath: string): boolean {
  return fs.existsSync(filePath) && filePath.endsWith(HELIUM_DATA_PATHS.HISTORY_FILE);
}

/**
 * Get all candidate paths where cookies database might exist
 * Checks both newer (Network/Cookies) and older (Cookies) locations
 */
export function getCookiesDatabaseCandidates(userDataDir: string): string[] {
  const candidates: string[] = [];

  const profiles = getProfileCandidates(userDataDir);

  for (const profile of profiles) {
    // Newer Chromium: Network/Cookies subdirectory
    candidates.push(path.join(userDataDir, profile, "Network", HELIUM_DATA_PATHS.COOKIES_FILE));

    // Older Chromium: Direct Cookies file
    candidates.push(path.join(userDataDir, profile, HELIUM_DATA_PATHS.COOKIES_FILE));
  }

  // Root-level cookies (unlikely but check anyway)
  candidates.push(path.join(userDataDir, HELIUM_DATA_PATHS.COOKIES_FILE));

  return candidates;
}

/**
 * Find cookies database in Helium User Data directory
 * Returns the first found database (usually Default profile)
 */
export async function findCookiesDatabase(): Promise<string | null> {
  const userDataDir = await findHeliumUserDataDir();
  if (!userDataDir) {
    return null;
  }

  const candidates = getCookiesDatabaseCandidates(userDataDir);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Find all cookies databases across all profiles
 * Returns array of {path, profile} objects for multi-profile support
 * Uses utility function with direct fallback for common installation paths
 */
export async function findAllCookiesDatabases(): Promise<Array<{ path: string; profile: string }>> {
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

  const profiles = getProfileCandidates(userDataDir);

  for (const profile of profiles) {
    // Check newer location first
    const newerPath = path.join(userDataDir, profile, "Network", HELIUM_DATA_PATHS.COOKIES_FILE);
    if (fs.existsSync(newerPath)) {
      databases.push({ path: newerPath, profile });
      continue; // Skip older location if newer exists
    }

    // Check older location
    const olderPath = path.join(userDataDir, profile, HELIUM_DATA_PATHS.COOKIES_FILE);
    if (fs.existsSync(olderPath)) {
      databases.push({ path: olderPath, profile });
    }
  }

  return databases;
}

/**
 * Check if a cookies database path is valid and readable
 */
export function isValidCookiesDatabase(filePath: string): boolean {
  return fs.existsSync(filePath) && filePath.endsWith(HELIUM_DATA_PATHS.COOKIES_FILE);
}
