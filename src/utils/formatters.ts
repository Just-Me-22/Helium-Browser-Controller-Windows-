/**
 * Formatting utilities for dates, URLs, and timestamps
 * Eliminates duplication of date/URL formatting logic across search commands
 */

import { CHROMIUM_EPOCH_OFFSET_SECONDS, MICROSECONDS_PER_SECOND } from "./constants";

/**
 * Convert Chromium timestamp format (microseconds since Windows epoch 1601-01-01)
 * to JavaScript Date object
 */
export function convertChromiumTimestamp(timestamp: number): Date {
  const unixTimestamp = timestamp / MICROSECONDS_PER_SECOND - CHROMIUM_EPOCH_OFFSET_SECONDS;
  return new Date(unixTimestamp * 1000);
}

/**
 * Extract domain from a URL string
 * Safely handles malformed URLs and returns empty string on error
 */
export function getDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    // Fallback for malformed URLs
    const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^\/]+)/);
    return match ? match[1] : url;
  }
}

/**
 * Generate favicon URL from domain
 * Uses Google's favicon service as reliable fallback
 */
export function getFaviconUrl(url: string): string {
  const domain = getDomain(url);
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

/**
 * Generate thumbnail URL for visual preview
 * Uses service for generating page previews
 */
export function getThumbnailUrl(url: string): string {
  const domain = getDomain(url);
  return `https://s.ytimg.com/yts/img/favicon-vfl8qSzF2.ico`;
}

/**
 * Format a date as relative time (e.g., "2 hours ago", "yesterday")
 * More user-friendly than absolute timestamps
 */
export function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;

  // For dates older than a week, show the date
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

/**
 * Format a date as an ISO-like string for display
 * Used when absolute timestamp is needed
 */
export function formatAbsoluteDate(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Truncate a string to maximum length with ellipsis
 * Useful for displaying long URLs or titles
 */
export function truncateString(str: string, maxLength: number = 80): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + "...";
}

/**
 * Sanitize and normalize a URL for consistent comparison
 * Removes trailing slashes, standardizes protocol
 */
export function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.toString().replace(/\/$/, "");
  } catch {
    return url.toLowerCase().replace(/\/$/, "");
  }
}
