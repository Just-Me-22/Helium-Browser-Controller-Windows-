/**
 * Global constants for the Helium Browser Controller extension
 * Centralizes all magic numbers and strings to reduce duplication
 */

// Chromium timestamp conversion
export const CHROMIUM_EPOCH_OFFSET_SECONDS = 11644473600;
export const MICROSECONDS_PER_SECOND = 1000000;

// Database operations
export const DB_QUERY_TIMEOUT_MS = 30000;
export const DB_BUSY_TIMEOUT_MS = 15000;
export const DB_MAX_BUFFER_BYTES = 10485760; // 10 MB

// Caching
export const CACHE_TTL_MS = 60000;

// File operations
export const MAX_FILE_REPLACE_ATTEMPTS = 5;
export const INITIAL_RETRY_DELAY_MS = 500;
export const RETRY_DELAY_BASE_MS = 300;

// Helium browser paths
export const HELIUM_PATHS = {
  // LocalAppData paths (most common)
  LOCAL_APP_DATA_CHROME: ["imput", "Helium", "Application", "chrome.exe"],
  LOCAL_APP_DATA_MAIN: ["imput", "Helium", "Helium.exe"],

  // Program Files variations
  PROGRAM_FILES_CHROME: ["Programs", "Helium", "Application", "chrome.exe"],
  PROGRAM_FILES_MAIN: ["Programs", "Helium", "Helium.exe"],
  PROGRAM_FILES_32_MAIN: ["Program Files (x86)", "Helium", "Helium.exe"],

  // Alternative locations
  ALT_LOCATION_1: ["imput", "Helium", "Application"],
  ALT_LOCATION_2: ["Helium", "Helium.exe"],
};

// Helium data file paths
export const HELIUM_DATA_PATHS = {
  PROFILE_DEFAULT: "Default",

  // Data files
  BOOKMARKS_FILE: "Bookmarks",
  HISTORY_FILE: "History",
  COOKIES_FILE: "Cookies",

  // Relative to User Data
  USER_DATA: "User Data",
};

// SQLite3 binary locations
export const SQLITE3_PATHS = [
  "assets/bin/sqlite3.exe",
  "assets/sqlite3.exe",
  "bin/sqlite3.exe",
  "sqlite3.exe",
];

// Selection modes
export enum SelectionMode {
  NORMAL = "normal",
  SELECTION = "selection",
}

// Action types
export enum ActionType {
  OPEN = "open",
  COPY = "copy",
  DELETE = "delete",
  CLEAR_ALL = "clearAll",
}

// Download states (Chromium download manager)
export enum DownloadState {
  IN_PROGRESS = 0,
  COMPLETE = 1,
  CANCELLED = 2,
  INTERRUPTED = 3,
  DANGEROUS = 4,
}

// Download state text mapping
export const DOWNLOAD_STATE_TEXT: Record<DownloadState, string> = {
  [DownloadState.IN_PROGRESS]: "In Progress",
  [DownloadState.COMPLETE]: "Complete",
  [DownloadState.CANCELLED]: "Cancelled",
  [DownloadState.INTERRUPTED]: "Interrupted",
  [DownloadState.DANGEROUS]: "Dangerous",
};

// Cookie value preview length
export const MAX_COOKIE_VALUE_PREVIEW_LENGTH = 50;

// SameSite cookie attribute values
export enum SameSiteValue {
  UNSPECIFIED = -1,
  NO_RESTRICTION = 0,
  LAX = 1,
  STRICT = 2,
}
