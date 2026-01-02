import { showHUD } from "@raycast/api";
import { spawn } from "child_process";
import { findHeliumPath } from "./utils/browser";
import { escapePowerShellString, escapeCmdString, execPowerShell } from "./utils/shell";

// Private window flags that Chromium-based browsers support
const PRIVATE_WINDOW_FLAGS = ["--incognito", "--private-window", "--inprivate", "-private"];

async function launchPrivateWindow(heliumPath: string): Promise<boolean> {
  // Strategy 1: Try spawn with each private mode flag (safest - no shell injection)
  for (const flag of PRIVATE_WINDOW_FLAGS) {
    try {
      spawn(heliumPath, [flag], { detached: true, stdio: "ignore" }).unref();
      return true;
    } catch {
      // Continue to next flag
    }
  }

  // Strategy 2: PowerShell Start-Process with private mode flags
  const escapedPath = escapePowerShellString(heliumPath);
  for (const flag of PRIVATE_WINDOW_FLAGS) {
    try {
      const psCommand = `Start-Process -FilePath '${escapedPath}' -ArgumentList '${flag}' -ErrorAction Stop`;
      await execPowerShell(psCommand);
      return true;
    } catch {
      // Continue to next flag
    }
  }

  // Strategy 3: CMD start command (fallback)
  try {
    const escapedPath = escapeCmdString(heliumPath);
    spawn("cmd.exe", ["/c", `start "" "${escapedPath}" --incognito`], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return true;
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Failed to launch private window:", errorMsg);
  }

  return false;
}

export default async function main() {
  try {
    const heliumPath = await findHeliumPath();

    if (!heliumPath) {
      await showHUD("❌ Helium browser not found. Please check installation.");
      return;
    }

    const success = await launchPrivateWindow(heliumPath);
    await showHUD(success ? "✅ Private window opened" : "❌ Failed to open private window");
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error launching private window:", errorMsg);
    await showHUD("❌ Failed to open private window");
  }
}
