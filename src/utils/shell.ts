/**
 * Shell execution utilities for PowerShell, CMD, and process spawning
 * Centralizes Windows process execution and command escaping
 */

import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

/**
 * Escape a string for safe use in PowerShell single-quoted strings
 * PowerShell escaping: replace ' with ''
 */
export function escapePowerShellString(input: string): string {
  return input.replace(/'/g, "''");
}

/**
 * Escape a string for safe use in CMD double-quoted strings
 * CMD escaping: replace " with ""
 */
export function escapeCmdString(input: string): string {
  return input.replace(/"/g, '""');
}

/**
 * Execute a PowerShell command and return the output
 * Handles errors gracefully with proper output encoding
 */
export function execPowerShell(command: string): Promise<string> {
  return new Promise((resolve) => {
    const ps = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = "";
    let errorOutput = "";

    ps.stdout?.on("data", (data) => {
      output += data.toString();
    });

    ps.stderr?.on("data", (data) => {
      errorOutput += data.toString();
    });

    ps.on("close", () => {
      resolve(output.trim());
    });

    ps.on("error", () => {
      resolve("");
    });
  });
}

/**
 * Launch a URL in the default browser using PowerShell
 * Strategy 1: Direct spawn with URL argument
 */
export async function launchUrlWithSpawn(
  browserPath: string,
  url: string
): Promise<boolean> {
  try {
    spawn(browserPath, [url], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Launch a URL in the default browser using PowerShell
 * Strategy 2: PowerShell Start-Process command
 */
export async function launchUrlWithPowerShell(
  browserPath: string,
  url: string
): Promise<boolean> {
  try {
    const escapedPath = escapePowerShellString(browserPath);
    const escapedUrl = escapePowerShellString(url);

    const psCommand = `
      $p = New-Object System.Diagnostics.ProcessStartInfo
      $p.FileName = '${escapedPath}'
      $p.Arguments = '${escapedUrl}'
      $p.UseShellExecute = $false
      [System.Diagnostics.Process]::Start($p)
    `;

    const result = await execPowerShell(psCommand);
    return result.length > 0 || true; // Assume success if command executed
  } catch {
    return false;
  }
}

/**
 * Launch a URL in the default browser using CMD
 * Strategy 3: CMD start command (fallback)
 */
export async function launchUrlWithCmd(
  browserPath: string,
  url: string
): Promise<boolean> {
  try {
    const escapedPath = escapeCmdString(browserPath);
    const escapedUrl = escapeCmdString(url);

    const cmdCommand = `start "" "${escapedPath}" "${escapedUrl}"`;

    spawn("cmd.exe", ["/c", cmdCommand], {
      detached: true,
      stdio: "ignore",
    }).unref();

    return true;
  } catch {
    return false;
  }
}

/**
 * Launch a URL using a 3-strategy fallback approach
 * 1. spawn (fastest)
 * 2. PowerShell Start-Process (reliable)
 * 3. CMD start (most compatible)
 */
export async function launchUrlInBrowser(
  browserPath: string,
  url: string
): Promise<boolean> {
  // Strategy 1: Direct spawn
  if (await launchUrlWithSpawn(browserPath, url)) {
    return true;
  }

  // Strategy 2: PowerShell
  if (await launchUrlWithPowerShell(browserPath, url)) {
    return true;
  }

  // Strategy 3: CMD (fallback)
  return await launchUrlWithCmd(browserPath, url);
}

/**
 * Send keyboard keys to active window via PowerShell WScript.Shell
 * Used for sending Ctrl+T (new tab), Ctrl+N (new window) commands
 */
export async function sendKeyboardShortcut(keys: string): Promise<boolean> {
  try {
    const psCommand = `
      $shell = New-Object -ComObject WScript.Shell
      $shell.SendKeys('${keys}')
    `;

    await execPowerShell(psCommand);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a process is running by name (e.g., "chrome", "Helium")
 */
export async function isProcessRunning(processName: string): Promise<boolean> {
  try {
    const output = await execPowerShell(
      `Get-Process -Name ${processName} -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count`
    );
    return parseInt(output) > 0;
  } catch {
    return false;
  }
}

/**
 * Get the path to an executable using the Windows "where" command
 */
export async function getExecutablePath(
  exeName: string
): Promise<string | null> {
  try {
    const output = await execPowerShell(`where.exe ${exeName}`);
    return output ? output.split("\n")[0].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Query Windows Registry for a value using PowerShell
 * Used to find Helium installation directory in registry
 */
export async function getRegistryValue(
  hive: string,
  path: string,
  valueName: string
): Promise<string | null> {
  try {
    const psCommand = `
      $regPath = '${escapePowerShellString(hive)}\\${escapePowerShellString(path)}'
      $regValue = Get-ItemProperty -Path $regPath -Name '${escapePowerShellString(valueName)}' -ErrorAction SilentlyContinue
      if ($null -ne $regValue) { $regValue.'${escapePowerShellString(valueName)}' }
    `;

    const output = await execPowerShell(psCommand);
    return output || null;
  } catch {
    return null;
  }
}

/**
 * Create a temporary PowerShell script file and execute it
 * Useful for complex multi-line PowerShell commands
 */
export async function executePowerShellScript(
  scriptContent: string
): Promise<string> {
  const tempDir = os.tmpdir();
  const scriptPath = path.join(tempDir, `ps-${Date.now()}.ps1`);

  try {
    fs.writeFileSync(scriptPath, scriptContent, "utf8");

    const output = await new Promise<string>((resolve) => {
      const ps = spawn("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      ps.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      ps.on("close", () => {
        resolve(stdout.trim());
      });

      ps.on("error", () => {
        resolve("");
      });
    });

    return output;
  } finally {
    // Clean up temp script
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}
