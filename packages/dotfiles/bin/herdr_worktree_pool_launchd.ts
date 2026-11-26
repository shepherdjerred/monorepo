import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const prefix = "com.jerred.herdr-worktree.job.";
/** A finished job that is still loaded after this long was killed before it could remove itself. */
const staleAfterMs = 10 * 60_000;

/**
 * What a job runs under launchd: `$1` is launchctl, `$2` the job's launchd
 * target, `$3` the folder, and the rest the command. Whatever way the command
 * ends, including a signal that reaches this shell, the job unloads itself.
 */
export const runner = `launchctl=$1
target=$2
cwd=$3
shift 3
finish() {
  result=$?
  if [ "$result" -ne 0 ]; then
    /usr/bin/logger -t herdr-worktree "$target exited with status $result" || :
  fi
  "$launchctl" bootout "$target" >/dev/null 2>&1 || :
}
trap finish EXIT
cd "$cwd" || exit 1
"$@" &
child=$!
# A signal for this shell (launchctl kill sends it to this process only) is
# passed on to the command, so the shell does not sit waiting for it. The job's
# own output goes to /dev/null, so kill's complaint about a finished command
# is not seen.
trap 'kill -TERM "$child" || :' TERM HUP INT
status=0
wait "$child" || status=$?
while kill -0 "$child"; do
  wait "$child" || status=$?
done
exit "$status"
`;

export type LaunchctlResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

/** The computer a background job is submitted from; real by default, fake in tests. */
export type Launchd = {
  readonly platform: string;
  readonly uid: number | undefined;
  readonly home: string;
  readonly path: string | undefined;
  readonly now: () => number;
  readonly launchctl: (args: readonly string[]) => Promise<LaunchctlResult>;
  readonly logError: (message: string) => void;
};

async function launchctl(args: readonly string[]): Promise<LaunchctlResult> {
  const child = Bun.spawn(["/bin/launchctl", ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

function logError(message: string): void {
  Bun.spawnSync(["/usr/bin/logger", "-t", "herdr-worktree", message], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
}

export const realLaunchd: Launchd = {
  platform: process.platform,
  uid: process.getuid?.(),
  home: homedir(),
  path: Bun.env["PATH"],
  now: Date.now,
  launchctl,
  logError,
};

function plistString(text: string): string {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<string>${escaped}</string>`;
}

/**
 * Unload jobs of ours that are no longer running and are old enough that they
 * cannot be one still starting: a job killed before its trap ran stays loaded.
 */
async function sweepStale(domain: string, on: Launchd): Promise<void> {
  const listed = await on.launchctl(["list"]);
  if (listed.code !== 0) return;
  for (const line of listed.stdout.split("\n")) {
    const [pid, , label] = line.split("\t");
    if (pid !== "-" || label?.startsWith(prefix) !== true) continue;
    const started = Number(label.slice(prefix.length).split("-")[0]);
    if (!Number.isFinite(started) || on.now() - started < staleAfterMs)
      continue;
    const result = await on.launchctl(["bootout", `${domain}/${label}`]);
    on.logError(
      `Unloaded stale background job ${label}${result.code === 0 ? "" : ` (launchctl exit ${String(result.code)})`}`,
    );
  }
}

/**
 * Submit `argv` to the user's launchd domain as a one-shot job and return its
 * label. launchd owns the job, so it survives the `hc exec` session that
 * submitted it. The job gets `HOME` and `PATH` only (`env -i` also drops
 * anything registered with launchd, such as password-manager or API tokens),
 * its output is discarded, and it unloads itself when the command ends. Throws
 * when launchd refuses it, as with no GUI login on this Mac.
 */
export async function startMacBackground(
  cwd: string,
  argv: readonly string[],
  on: Launchd = realLaunchd,
): Promise<string> {
  if (on.uid === undefined || on.platform !== "darwin")
    throw new Error("A macOS user login domain is required.");
  const domain = `gui/${String(on.uid)}`;
  // The millisecond time is the job age for the sweep; the uuid makes it unique.
  const label = `${prefix}${String(on.now())}-${randomUUID()}`;
  const args = [
    "/usr/bin/env",
    "-i",
    `HOME=${on.home}`,
    `PATH=${on.path ?? "/opt/homebrew/bin:/usr/bin:/bin"}`,
    "/bin/sh",
    "-c",
    runner,
    label,
    "/bin/launchctl",
    `${domain}/${label}`,
    cwd,
    ...argv,
  ];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key>${plistString(label)}
<key>ProgramArguments</key><array>${args.map((arg) => plistString(arg)).join("")}</array>
<key>RunAtLoad</key><true/>
<key>LaunchOnlyOnce</key><true/>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>/dev/null</string>
<key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>
`;
  await sweepStale(domain, on).catch((error: unknown) => {
    on.logError(
      `Could not sweep stale background jobs: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const directory = await mkdtemp(path.join(tmpdir(), "herdr-launchd-job-"));
  try {
    const file = path.join(directory, "job.plist");
    await writeFile(file, plist, { mode: 0o600 });
    const result = await on.launchctl(["bootstrap", domain, file]);
    if (result.code !== 0) {
      const message = `Could not submit macOS background job: ${result.stderr.trim() || String(result.code)}`;
      on.logError(message);
      throw new Error(message);
    }
    return label;
  } finally {
    // launchd has read the plist once bootstrap returns.
    await rm(directory, { recursive: true, force: true }).catch(
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        on.logError(`Could not clean up the background job plist: ${detail}`);
      },
    );
  }
}
