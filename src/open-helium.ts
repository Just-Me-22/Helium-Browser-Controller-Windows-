import { showHUD, getPreferenceValues } from "@raycast/api";
import { spawn } from "child_process";
import { findHeliumPath } from "./utils/browser";

type Preferences = {
  heliumPath?: string;
};

/**
 * Launch Helium browser bypassing first-run setup
 * Uses Chromium flags to skip setup dialogs
 */
async function launchHelium(heliumPath: string): Promise<boolean> {
  // Chromium flags to skip first-run experience
  const skipSetupFlags = [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-first-run-ui",
  ];

  try {
    // Strategy 1: Direct spawn with skip-setup flags
    spawn(heliumPath, skipSetupFlags, { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    // Strategy 2: CMD fallback with flags
    try {
      const escapedPath = heliumPath.replace(/"/g, '""');
      const flagsStr = skipSetupFlags.join(" ");
      spawn("cmd.exe", ["/c", `start "" "${escapedPath}" ${flagsStr}`], {
        detached: true,
        stdio: "ignore",
      }).unref();
      return true;
    } catch {
      return false;
    }
  }
}

export default async function main() {
  try {
    const prefs = getPreferenceValues<Preferences>();
    const heliumPath = await findHeliumPath(prefs.heliumPath);

    if (!heliumPath) {
      await showHUD("❌ Helium not found — set path in preferences");
      return;
    }

    // Launch Helium without specifying a URL - uses existing profile/home page
    // This prevents first-time setup screen and opens with saved settings
    const success = await launchHelium(heliumPath);

    if (success) {
      await showHUD("✅ Helium opened");
    } else {
      await showHUD("❌ Failed to open Helium");
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error launching Helium:", errorMsg);
    await showHUD("❌ Failed to open Helium");
  }
}
