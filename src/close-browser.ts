import { showHUD } from "@raycast/api";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function getBrowserProcesses(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `powershell -Command "Get-Process helium,chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -ExpandProperty Id"`
    );
    
    const pids = stdout.trim().split('\n').filter(Boolean);
    if (pids.length === 0) {
      throw new Error('No browser windows found');
    }
    return pids;
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error finding processes:", error.message);
    }
    throw error;
  }
}

async function closeProcesses(pids: string[]): Promise<void> {
  try {
    await execAsync(`powershell -Command "${pids.map(pid => `Stop-Process -Id ${pid}`).join('; ')}"`);
  } catch {
    await execAsync(`powershell -Command "${pids.map(pid => `Stop-Process -Id ${pid} -Force`).join('; ')}"`);
  }
}

export default async function main() {
  try {
    const pids = await getBrowserProcesses();
    await closeProcesses(pids);
    await showHUD(`✅ Closed ${pids.length} browser window(s)`);
  } catch (error) {
    if (error instanceof Error && error.message === 'No browser windows found') {
      await showHUD("ℹ️ No active Helium/Chrome windows found");
    } else {
      await showHUD("❌ Failed to close browser");
      if (error instanceof Error) {
        console.error("Error closing browser:", error.message);
      }
    }
  }
}
