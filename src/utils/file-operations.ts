/**
 * File operation utilities with retry logic
 * Centralizes copy, replace, and cleanup operations used by search commands
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { INITIAL_RETRY_DELAY_MS, RETRY_DELAY_BASE_MS, MAX_FILE_REPLACE_ATTEMPTS } from "./constants";

/**
 * Copy file with retry logic to handle temporary locks
 * Returns true if successful, false if all retries exhausted
 */
export async function copyFileWithRetry(
  sourcePath: string,
  destPath: string,
  maxAttempts: number = 3,
  initialDelayMs: number = INITIAL_RETRY_DELAY_MS
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      fs.copyFileSync(sourcePath, destPath);
      return true;
    } catch (error: unknown) {
      if (attempt < maxAttempts - 1) {
        // Calculate exponential backoff delay
        const delayMs = initialDelayMs * Math.pow(1.5, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  return false;
}

/**
 * Replace a file with retry logic to handle Windows file locking
 * Copy to temp → modify → replace original file with retries
 */
export async function replaceFileSafely(
  sourceFile: string,
  targetFile: string,
  options?: {
    maxAttempts?: number;
    delayMs?: number;
  }
): Promise<boolean> {
  const maxAttempts = options?.maxAttempts ?? MAX_FILE_REPLACE_ATTEMPTS;
  const delayMs = options?.delayMs ?? RETRY_DELAY_BASE_MS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Copy modified file back to original location
      fs.copyFileSync(sourceFile, targetFile);

      // Touch the file to trigger file watcher updates
      fs.utimesSync(targetFile, new Date(), new Date());

      return true;
    } catch (error: unknown) {
      if (attempt < maxAttempts - 1) {
        // Exponential backoff: first retry after delayMs, then delayMs * 2, etc.
        const waitTime = delayMs * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  return false;
}

/**
 * Create a temporary file copy for safe modification
 * Returns the temp file path or null if creation failed
 */
export function createTempFileCopy(sourcePath: string, prefix: string = "helium-"): string | null {
  try {
    const tempDir = os.tmpdir();
    const ext = path.extname(sourcePath);
    const tempPath = path.join(tempDir, `${prefix}${Date.now()}${ext}`);

    fs.copyFileSync(sourcePath, tempPath);
    return tempPath;
  } catch {
    return null;
  }
}

/**
 * Safely delete a temporary file
 * Silently ignores errors (file may already be deleted)
 */
export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup errors - temp files are transient
  }
}

/**
 * Read file with retry logic to handle locks
 */
export async function readFileWithRetry(
  filePath: string,
  maxAttempts: number = 3,
  delayMs: number = 300
): Promise<string | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch (error: unknown) {
      if (attempt < maxAttempts - 1) {
        const waitTime = delayMs * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }
  return null;
}

/**
 * Write file with retry logic to handle locks
 */
export async function writeFileWithRetry(
  filePath: string,
  content: string,
  maxAttempts: number = 3,
  delayMs: number = 300
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      fs.writeFileSync(filePath, content, "utf-8");
      return true;
    } catch (error: unknown) {
      if (attempt < maxAttempts - 1) {
        const waitTime = delayMs * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }
  return false;
}

/**
 * Delete a file with retry logic
 */
export async function deleteFileWithRetry(
  filePath: string,
  maxAttempts: number = 3,
  delayMs: number = 300
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return true;
    } catch (error: unknown) {
      if (attempt < maxAttempts - 1) {
        const waitTime = delayMs * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }
  return false;
}

/**
 * Ensure a directory exists (create if missing)
 */
export function ensureDirectoryExists(dirPath: string): boolean {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file size in bytes
 */
export function getFileSize(filePath: string): number | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch {
    return null;
  }
}

/**
 * Check if file was modified within last N milliseconds
 */
export function isFileRecentlyModified(
  filePath: string,
  withinMs: number = 60000
): boolean {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    const stats = fs.statSync(filePath);
    const now = Date.now();
    return now - stats.mtimeMs.getTime() < withinMs;
  } catch {
    return false;
  }
}
