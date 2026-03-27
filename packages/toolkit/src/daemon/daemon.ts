import { stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const HOME = Bun.env["HOME"] ?? "~";
const PLIST_NAME = "com.shepherdjerred.toolkit-recall";
const PLIST_DIR = path.join(HOME, "Library", "LaunchAgents");
const PLIST_PATH = path.join(PLIST_DIR, `${PLIST_NAME}.plist`);
const TOOLKIT_BIN = path.join(HOME, ".local", "bin", "toolkit");
const LOGS_DIR = path.join(HOME, ".recall", "logs");

function generatePlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${TOOLKIT_BIN}</string>
        <string>recall</string>
        <string>watch</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOGS_DIR}/daemon-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${LOGS_DIR}/daemon-stderr.log</string>
    <key>WorkingDirectory</key>
    <string>${HOME}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>`;
}

export async function daemonStart(verbose: boolean): Promise<void> {
  // Ensure logs directory exists
  await mkdir(LOGS_DIR, { recursive: true });
  await mkdir(PLIST_DIR, { recursive: true });

  // Write plist
  await writeFile(PLIST_PATH, generatePlist(), "utf8");
  if (verbose) console.error(`[daemon] wrote plist: ${PLIST_PATH}`);

  // Load the agent
  const proc = Bun.spawn(["launchctl", "load", PLIST_PATH], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  if (proc.exitCode !== 0 && !stderr.includes("already loaded")) {
    console.error(`Failed to load daemon: ${stderr.trim()}`);
    process.exit(1);
  }

  console.log(`Daemon started. Plist: ${PLIST_PATH}`);
  console.log(`Logs: ${LOGS_DIR}/`);
}

export async function daemonStop(_verbose: boolean): Promise<void> {
  const exists = await stat(PLIST_PATH).catch(() => null);
  if (exists == null) {
    console.error("Daemon plist not found. Is it installed?");
    process.exit(1);
  }

  const proc = Bun.spawn(["launchctl", "unload", PLIST_PATH], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  if (proc.exitCode !== 0 && !stderr.includes("Could not find")) {
    console.error(`Failed to stop daemon: ${stderr.trim()}`);
    process.exit(1);
  }

  console.log("Daemon stopped.");
}

export async function daemonStatus(verbose: boolean): Promise<void> {
  // Check if plist exists
  const plistExists = await stat(PLIST_PATH).catch(() => null);

  // Check launchctl list
  const proc = Bun.spawn(["launchctl", "list", PLIST_NAME], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  const isRunning = proc.exitCode === 0;

  console.log("Recall Daemon");
  console.log(`  Plist:   ${plistExists == null ? "not installed" : "installed"}`);
  console.log(`  Status:  ${isRunning ? "running" : "stopped"}`);

  if (isRunning && verbose) {
    // Parse PID from launchctl list output
    const pidMatch = /"PID"\s*=\s*(\d+)/.exec(stdout);
    if (pidMatch?.[1] != null) {
      console.log(`  PID:     ${pidMatch[1]}`);
    }
  }

  // Check recent log activity
  const stderrLogPath = path.join(LOGS_DIR, "daemon-stderr.log");
  const stderrExists = await stat(stderrLogPath).catch(() => null);
  if (stderrExists != null) {
    console.log(`  Stderr:  ${stderrLogPath} (${formatBytes(stderrExists.size)})`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
