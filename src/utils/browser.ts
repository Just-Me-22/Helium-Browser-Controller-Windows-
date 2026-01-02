/**
 * Browser detection and path resolution
 * Centralizes all Helium browser path finding logic from 5 duplicate implementations
 */

import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { execPowerShell, getExecutablePath, getRegistryValue } from "./shell";
import { HELIUM_PATHS } from "./constants";

/**
 * Get all possible LocalAppData paths from environment variables and system paths
 */
export function getLocalAppDataPaths(): string[] {
  const paths: string[] = [];

  // Primary source: LOCALAPPDATA environment variable
  if (process.env.LOCALAPPDATA) {
    paths.push(process.env.LOCALAPPDATA);
  }

  // Secondary: USERPROFILE + AppData\Local
  if (process.env.USERPROFILE) {
    const candidate = path.join(process.env.USERPROFILE, "AppData", "Local");
    if (!paths.includes(candidate)) {
      paths.push(candidate);
    }
  }

  // Tertiary: System home directory
  try {
    const homeDir = os.homedir();
    if (homeDir) {
      const candidate = path.join(homeDir, "AppData", "Local");
      if (!paths.includes(candidate)) {
        paths.push(candidate);
      }
    }
  } catch {
    // Ignore errors from os.homedir()
  }

  return paths;
}

/**
 * Get all possible Program Files paths from environment variables
 */
export function getProgramFilesPaths(): string[] {
  const paths: string[] = [];

  if (process.env.PROGRAMFILES) {
    paths.push(process.env.PROGRAMFILES);
  }

  if (process.env["ProgramFiles(x86)"]) {
    paths.push(process.env["ProgramFiles(x86)"]);
  }

  return paths;
}

/**
 * Generate list of candidate paths where Helium executable might be installed
 * Tries multiple variations: LocalAppData, Program Files, custom locations
 */
export function getHeliumCandidatePaths(): string[] {
  const candidates: string[] = [];

  const localAppDataPaths = getLocalAppDataPaths();
  const programFilesPaths = getProgramFilesPaths();

  // LocalAppData variations
  for (const basePath of localAppDataPaths) {
    candidates.push(path.join(basePath, ...HELIUM_PATHS.LOCAL_APP_DATA_CHROME));
    candidates.push(path.join(basePath, ...HELIUM_PATHS.LOCAL_APP_DATA_MAIN));
  }

  // Program Files variations
  for (const basePath of programFilesPaths) {
    candidates.push(path.join(basePath, ...HELIUM_PATHS.PROGRAM_FILES_CHROME));
    candidates.push(path.join(basePath, ...HELIUM_PATHS.PROGRAM_FILES_MAIN));
  }

  // Additional paths
  for (const basePath of localAppDataPaths) {
    candidates.push(path.join(basePath, ...HELIUM_PATHS.ALT_LOCATION_1));
    candidates.push(path.join(basePath, ...HELIUM_PATHS.ALT_LOCATION_2));
  }

  return candidates;
}

/**
 * Check if a given path points to a valid Helium/Chrome executable
 */
function isValidExecutablePath(filePath: string): boolean {
  return fs.existsSync(filePath) && (filePath.endsWith("chrome.exe") || filePath.endsWith("Helium.exe"));
}

/**
 * Find Helium browser executable with 4-strategy fallback approach
 * 1. Check preferred path (if provided)
 * 2. Try candidate installation paths
 * 3. Query Windows Registry
 * 4. Use "where" command to find in PATH
 */
export async function findHeliumPath(preferredPath?: string): Promise<string | null> {
  // Strategy 1: Check preferred/saved path first
  if (preferredPath && isValidExecutablePath(preferredPath)) {
    return preferredPath;
  }

  // Strategy 2: Try candidate paths
  const candidates = getHeliumCandidatePaths();
  for (const candidate of candidates) {
    if (isValidExecutablePath(candidate)) {
      return candidate;
    }
  }

  // Strategy 3: Try Windows Registry
  try {
    // Try HKCU first (current user)
    let regPath = await getRegistryValue(
      "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Helium.exe",
      "",
      "Path"
    );

    if (regPath) {
      const fullPath = path.join(regPath, "Helium.exe");
      if (isValidExecutablePath(fullPath)) {
        return fullPath;
      }
    }

    // Try HKLM (local machine) if HKCU fails
    regPath = await getRegistryValue(
      "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Helium.exe",
      "",
      "Path"
    );

    if (regPath) {
      const fullPath = path.join(regPath, "Helium.exe");
      if (isValidExecutablePath(fullPath)) {
        return fullPath;
      }
    }
  } catch {
    // Registry lookup failed, continue to next strategy
  }

  // Strategy 4: Search PATH using "where" command
  try {
    const wherePath = await getExecutablePath("Helium.exe");
    if (wherePath && isValidExecutablePath(wherePath)) {
      return wherePath;
    }

    // Also try chrome.exe in case installation uses that name
    const chromePath = await getExecutablePath("chrome.exe");
    if (chromePath && isValidExecutablePath(chromePath)) {
      return chromePath;
    }
  } catch {
    // "where" command failed, all strategies exhausted
  }

  return null;
}

/**
 * Find Helium installation directory (containing User Data folder)
 * Useful for accessing bookmarks, history, preferences
 */
export async function findHeliumInstallDir(): Promise<string | null> {
  const execPath = await findHeliumPath();
  if (!execPath) {
    return null;
  }

  // For Helium: chrome.exe is in Application folder
  if (execPath.endsWith("chrome.exe")) {
    return path.dirname(path.dirname(execPath)); // Go up two levels: Application -> Helium
  }

  // For main Helium.exe
  return path.dirname(execPath);
}

/**
 * Find Helium User Data directory
 * Contains profiles, bookmarks, history
 */
export async function findHeliumUserDataDir(
  installDir?: string
): Promise<string | null> {
  const baseDir = installDir || (await findHeliumInstallDir());
  if (!baseDir) {
    return null;
  }

  const userDataPath = path.join(baseDir, "User Data");
  if (fs.existsSync(userDataPath)) {
    return userDataPath;
  }

  return null;
}

/**
 * Check if Helium browser is installed on this system
 */
export async function isHeliumInstalled(): Promise<boolean> {
  return (await findHeliumPath()) !== null;
}

/**
 * Validate that a given path points to Helium browser
 */
export function isHeliumExecutable(filePath: string): boolean {
  return isValidExecutablePath(filePath);
}
