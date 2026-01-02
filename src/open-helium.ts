import { showHUD, getPreferenceValues } from "@raycast/api";
import { spawn } from "child_process";
import { findHeliumPath } from "./utils/browser";

type Preferences = {
  heliumPath?: string;
};

/**
 * Launch Helium browser with home page
 * This bypasses first-time setup and opens the home page
 */
async function launchHelium(heliumPath: string): Promise<boolean> {
  try {
    // Strategy 1: Direct spawn with about:home
    // This opens home instead of setup screen
    spawn(heliumPath, ["about:home"], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    // Strategy 2: Fallback with empty profile (uses existing profile)
    try {
      spawn(heliumPath, [], { detached: true, stdio: "ignore" }).unref();
      return true;
    } catch {
      // Strategy 3: CMD fallback
      try {
        const escapedPath = heliumPath.replace(/"/g, '""');
        spawn("cmd.exe", ["/c", `start "" "${escapedPath}" about:home`], {
          detached: true,
          stdio: "ignore",
        }).unref();
        return true;
      } catch {
        return false;
      }
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
