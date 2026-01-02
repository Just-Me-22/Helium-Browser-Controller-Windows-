/**
 * Data file location utilities for Helium browser
 * Centralizes finding bookmarks and history database files
 */

import * as path from "path";
import * as fs from "fs";
import { findHeliumUserDataDir } from "./browser";
import { HELIUM_DATA_PATHS } from "./constants";

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
