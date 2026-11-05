import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Per-user LaunchAgent plumbing shared by toolkit's background jobs.
 *
 * A job is either a resident daemon (`keepAlive`) or a one-shot command that
 * launchd re-runs on an interval (`startIntervalSeconds`). Plists and logs are
 * private to the user (0600 in 0700 directories) because they name local
 * history paths.
 */
export type LaunchAgentSpec = {
  readonly label: string;
  readonly plistPath: string;
  readonly programArguments: readonly string[];
  readonly logsDir: string;
  /** Restart the program whenever it exits. */
  readonly keepAlive: boolean;
  /** Re-run a one-shot program every N seconds. */
  readonly startIntervalSeconds?: number;
  /**
   * Environment for the job. launchd starts jobs with a minimal `PATH`
   * (`/usr/bin:/bin:/usr/sbin:/sbin`), so a job that spawns Homebrew tools
   * such as `op` must say where they live.
   */
  readonly environment?: Readonly<Record<string, string>>;
};

/** `PATH` for jobs that spawn Homebrew-installed tools. */
export const HOMEBREW_JOB_PATH =
  "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * The argv that re-invokes the current program: the compiled binary itself,
 * or `bun run <entry>` when running from source.
 */
export function selfArgv(args: readonly string[]): string[] {
  const executable = process.execPath;
  const isCompiled = !path.basename(executable).startsWith("bun");
  return isCompiled
    ? [executable, ...args]
    : [executable, "run", Bun.main, ...args];
}

export function launchAgentLogPaths(spec: LaunchAgentSpec): {
  readonly stdout: string;
  readonly stderr: string;
} {
  return {
    stdout: path.join(spec.logsDir, "launchd.stdout.log"),
    stderr: path.join(spec.logsDir, "launchd.stderr.log"),
  };
}

export function renderLaunchAgentPlist(spec: LaunchAgentSpec): string {
  const programArguments = spec.programArguments
    .map((argument) => `    <string>${xmlEscape(argument)}</string>`)
    .join("\n");
  const logs = launchAgentLogPaths(spec);
  const keepAlive = spec.keepAlive ? "  <key>KeepAlive</key>\n  <true/>\n" : "";
  const interval =
    spec.startIntervalSeconds === undefined
      ? ""
      : `  <key>StartInterval</key>\n  <integer>${String(spec.startIntervalSeconds)}</integer>\n`;
  const entries = Object.entries(spec.environment ?? {});
  const environment =
    entries.length === 0
      ? ""
      : `  <key>EnvironmentVariables</key>\n  <dict>\n${entries
          .map(
            ([key, value]) =>
              `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>\n`,
          )
          .join("")}  </dict>\n`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(spec.label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>RunAtLoad</key>
  <true/>
${keepAlive}${interval}${environment}  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logs.stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logs.stderr)}</string>
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
  return `gui/${String(os.userInfo().uid)}`;
}

export function assertDarwin(action: string): void {
  if (process.platform !== "darwin") {
    throw new Error(
      `${action} uses a macOS LaunchAgent and is not available on this platform.`,
    );
  }
}

export async function launchAgentLoaded(label: string): Promise<boolean> {
  const processHandle = Bun.spawn(
    ["launchctl", "print", `${guiDomain()}/${label}`],
    { stdout: "pipe", stderr: "pipe" },
  );
  return (await processHandle.exited) === 0;
}

export async function bootoutLaunchAgent(label: string): Promise<void> {
  if (!(await launchAgentLoaded(label))) {
    return;
  }
  await launchctl(["bootout", `${guiDomain()}/${label}`]);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!(await launchAgentLoaded(label))) {
      return;
    }
    await Bun.sleep(50);
  }
  throw new Error(
    `LaunchAgent ${label} remained loaded after launchctl bootout`,
  );
}

/** Loads the agent, or restarts it in place when it is already loaded. */
export async function startLaunchAgentJob(
  spec: LaunchAgentSpec,
): Promise<void> {
  if (await launchAgentLoaded(spec.label)) {
    await launchctl(["kickstart", "-k", `${guiDomain()}/${spec.label}`]);
    return;
  }
  await launchctl(["bootstrap", guiDomain(), spec.plistPath]);
}

/** Writes the plist atomically, creates private logs, and (re)loads it. */
export async function installLaunchAgentJob(
  spec: LaunchAgentSpec,
): Promise<void> {
  await mkdir(spec.logsDir, { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(spec.plistPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${spec.plistPath}.${String(process.pid)}.tmp`;
  await Bun.write(temporaryPath, renderLaunchAgentPlist(spec));
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, spec.plistPath);
  await chmod(spec.plistPath, 0o600);
  const logs = launchAgentLogPaths(spec);
  for (const logPath of [logs.stdout, logs.stderr]) {
    await writeFile(logPath, "", { flag: "a", mode: 0o600 });
    await chmod(logPath, 0o600);
  }
  await bootoutLaunchAgent(spec.label);
  await launchctl(["bootstrap", guiDomain(), spec.plistPath]);
}

export async function uninstallLaunchAgentJob(
  spec: LaunchAgentSpec,
): Promise<void> {
  await bootoutLaunchAgent(spec.label);
  await rm(spec.plistPath, { force: false });
}

export async function launchAgentJobStatus(
  spec: LaunchAgentSpec,
): Promise<{ installed: boolean; loaded: boolean }> {
  if (process.platform !== "darwin") {
    return { installed: false, loaded: false };
  }
  const installed = await Bun.file(spec.plistPath).exists();
  const loaded = installed && (await launchAgentLoaded(spec.label));
  return { installed, loaded };
}
