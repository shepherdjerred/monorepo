import { chmod, mkdir, rm, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  defaultHistoryRuntimePaths,
  type HistoryRuntimePaths,
} from "./paths.ts";

const LABEL = "com.jerred.toolkit-history";

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function serveArgv(): string[] {
  const executable = process.execPath;
  const isCompiled = !path.basename(executable).startsWith("bun");
  return isCompiled
    ? [executable, "history", "daemon", "serve"]
    : [executable, "run", Bun.main, "history", "daemon", "serve"];
}

export function renderLaunchAgent(runtimePaths: HistoryRuntimePaths): string {
  const programArguments = serveArgv()
    .map((argument) => `    <string>${xmlEscape(argument)}</string>`)
    .join("\n");
  const stdout = path.join(runtimePaths.logsDir, "launchd.stdout.log");
  const stderr = path.join(runtimePaths.logsDir, "launchd.stderr.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderr)}</string>
</dict>
</plist>
`;
}

async function launchctl(args: string[]): Promise<string> {
  const processHandle = Bun.spawn(["launchctl", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ]);
  if (exitCode !== 0) {
    const detail =
      stderr.trim() || stdout.trim() || `exit code ${String(exitCode)}`;
    throw new Error(`launchctl ${args.join(" ")} failed: ${detail}`);
  }
  return stdout.trim();
}

function guiDomain(): string {
  const uid = String(os.userInfo().uid);
  return `gui/${uid}`;
}

async function jobLoaded(domain: string): Promise<boolean> {
  const processHandle = Bun.spawn(
    ["launchctl", "print", `${domain}/${LABEL}`],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const exitCode = await processHandle.exited;
  return exitCode === 0;
}

async function bootstrap(
  runtimePaths: HistoryRuntimePaths,
  domain: string,
): Promise<void> {
  if (await jobLoaded(domain)) {
    await launchctl(["kickstart", "-k", `${domain}/${LABEL}`]);
    return;
  }
  await launchctl(["bootstrap", domain, runtimePaths.launchAgent]);
}

export async function installLaunchAgent(
  runtimePaths = defaultHistoryRuntimePaths(),
): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(
      "History ingestion uses a macOS LaunchAgent and cannot be installed on this platform.",
    );
  }
  await mkdir(runtimePaths.historyDir, { recursive: true, mode: 0o700 });
  await mkdir(runtimePaths.logsDir, { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(runtimePaths.launchAgent), {
    recursive: true,
    mode: 0o700,
  });
  const temporaryPath = `${runtimePaths.launchAgent}.${String(process.pid)}.tmp`;
  await Bun.write(temporaryPath, renderLaunchAgent(runtimePaths));
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, runtimePaths.launchAgent);
  await chmod(runtimePaths.launchAgent, 0o600);
  for (const logPath of [
    path.join(runtimePaths.logsDir, "launchd.stdout.log"),
    path.join(runtimePaths.logsDir, "launchd.stderr.log"),
  ]) {
    await writeFile(logPath, "", { flag: "a", mode: 0o600 });
    await chmod(logPath, 0o600);
  }
  const domain = guiDomain();
  if (await jobLoaded(domain)) {
    await launchctl(["bootout", `${domain}/${LABEL}`]);
  }
  await launchctl(["bootstrap", domain, runtimePaths.launchAgent]);
  console.log(`History LaunchAgent installed: ${runtimePaths.launchAgent}`);
}

export async function startLaunchAgent(
  runtimePaths = defaultHistoryRuntimePaths(),
): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(
      "History ingestion uses a macOS LaunchAgent and cannot be started on this platform.",
    );
  }
  if (!(await Bun.file(runtimePaths.launchAgent).exists())) {
    throw new Error(
      `LaunchAgent is not installed. Run 'toolkit history daemon install' first.`,
    );
  }
  await bootstrap(runtimePaths, guiDomain());
  console.log("History daemon started.");
}

export async function stopLaunchAgent(
  runtimePaths = defaultHistoryRuntimePaths(),
): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(
      "History ingestion uses a macOS LaunchAgent and cannot be stopped on this platform.",
    );
  }
  const installed = await Bun.file(runtimePaths.launchAgent).exists();
  const domain = guiDomain();
  if (await jobLoaded(domain)) {
    await launchctl(["bootout", `${domain}/${LABEL}`]);
  }
  console.log(
    installed ? "History daemon stopped." : "History daemon was not installed.",
  );
}

export async function uninstallLaunchAgent(
  runtimePaths = defaultHistoryRuntimePaths(),
): Promise<void> {
  await stopLaunchAgent(runtimePaths);
  await rm(runtimePaths.launchAgent, { force: false });
  console.log(`History LaunchAgent removed: ${runtimePaths.launchAgent}`);
}

export async function launchAgentStatus(
  runtimePaths = defaultHistoryRuntimePaths(),
): Promise<{ installed: boolean; loaded: boolean }> {
  if (process.platform !== "darwin") {
    return { installed: false, loaded: false };
  }
  const installed = await Bun.file(runtimePaths.launchAgent).exists();
  const loaded = installed && (await jobLoaded(guiDomain()));
  return { installed, loaded };
}

export const HISTORY_LAUNCH_AGENT_LABEL = LABEL;
