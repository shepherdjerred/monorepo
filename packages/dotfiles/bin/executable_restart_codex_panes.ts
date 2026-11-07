#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import path from "node:path";
import {
  discover,
  errorMessage,
  restart,
  type Outcome,
} from "./codex_theme_restart_core.ts";
import {
  object,
  parseCodexTerminals,
  parseJson,
  snapshotOf,
  type Runtime,
} from "./codex_theme_restart_terminal.ts";
import {
  parseOptions,
  type Options,
  type Appearance,
} from "./codex_theme_restart_options.ts";
import { themeForAppearance } from "./codex_theme_restart_config.ts";
import {
  appendEvent,
  countOutcomes,
  countsLine,
  failureLines,
  readLastEvent,
  statusReport,
  succeeded,
  summaryLine,
  triggerOf,
  type RunEvent,
  type TerminalProcess,
} from "./codex_theme_restart_events.ts";

const hcPath = path.join(homedir(), ".local/bin/hc");
const stateDirectory = path.join(homedir(), ".local/state/codex-theme-restart");
const eventsPath = path.join(stateDirectory, "events.jsonl");
const loggerPath = "/usr/bin/logger";
const logTag = "codex-theme-restart";
const statePath = path.join(stateDirectory, "appearance.json");

// In particular, do not retain a password-manager service token or another
// terminal's hc address or thread identity in this long-lived, independent worker.
function commandEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of [
    "HOME",
    "USER",
    "LOGNAME",
    "PATH",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TERM",
  ]) {
    const value = Bun.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

async function command(args: string[], timeout = 15_000): Promise<string> {
  const program = args[0];
  if (program === undefined) throw new Error("Missing command");
  const child = Bun.spawn(args, {
    cwd: homedir(),
    env: commandEnvironment(),
    stdout: "pipe",
    stderr: "pipe",
    timeout,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  // Never include native argv, environment, or raw tool output in diagnostics.
  if (exitCode !== 0) {
    const operation =
      program === hcPath ? (args[1] ?? "hc") : path.basename(program);
    let code = "tooling_error";
    if (program === hcPath) {
      // hc writes {error: {kind, message, hint}} to stderr.
      const value = object(object(parseJson(stderr)).get("error")).get("kind");
      if (typeof value !== "string" || !/^[a-z_]+$/.test(value))
        throw new TypeError("Invalid hc error kind");
      code = value;
    }
    throw new Error(`${operation} failed: ${code} (exit ${String(exitCode)})`);
  }
  return stdout;
}

const runtime: Runtime = {
  conversationSaved(thread) {
    const catalog = new Database(
      path.join(homedir(), ".codex/state_5.sqlite"),
      { readonly: true },
    );
    try {
      return (
        catalog
          .query("SELECT 1 FROM threads WHERE id = ? AND archived = 0")
          .get(thread) !== null
      );
    } finally {
      catalog.close();
    }
  },
  hc: (args) => command([hcPath, ...args], 35_000),
  now: Date.now,
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

async function appearance(): Promise<Appearance> {
  const output = await command(["/opt/homebrew/bin/dark-notify", "--exit"]);
  const mode = output.trim();
  if (mode !== "light" && mode !== "dark")
    throw new Error("dark-notify returned an invalid appearance");
  return mode;
}

async function previousAppearance(): Promise<Appearance | undefined> {
  let contents: string;
  try {
    contents = await readFile(statePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
  const value = object(JSON.parse(contents)).get("appearance");
  if (value !== "light" && value !== "dark")
    throw new Error("Invalid appearance state file");
  return value;
}

async function recordAppearance(mode: Appearance): Promise<void> {
  const temporary = `${statePath}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ appearance: mode })}\n`, {
    mode: 0o600,
  });
  await rename(temporary, statePath);
}

async function acquireLock(): Promise<Database> {
  const database = new Database(path.join(stateDirectory, "lock.sqlite"), {
    create: true,
  });
  const deadline = Date.now() + 300_000;
  try {
    for (;;) {
      try {
        database.run("BEGIN IMMEDIATE");
        return database;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "SQLITE_BUSY"
        )
          throw error;
        if (Date.now() >= deadline)
          throw new Error(
            "Another restart is still running after five minutes",
            { cause: error },
          );
        await runtime.sleep(250);
      }
    }
  } catch (error) {
    database.close();
    throw error;
  }
}

function report(outcome: Outcome): void {
  console.log(`${outcome.status}: ${outcome.terminal}: ${outcome.message}`);
}

async function restartTerminals(
  options: Options,
  mode: Appearance,
): Promise<Outcome[]> {
  const continued = new Set<string>();
  try {
    const discovered = await discover(runtime, mode, {
      ...(options.terminal === undefined ? {} : { terminal: options.terminal }),
      probe: !options.dryRun,
    });
    const outcomes = [...discovered.outcomes];
    for (const outcome of discovered.outcomes) report(outcome);
    for (const target of discovered.targets) {
      const outcome: Outcome = options.probeIdentities
        ? {
            terminal: target.terminal,
            status: "identified",
            message: `Native /status verified conversation ${String(target.thread)}; client left running`,
          }
        : options.dryRun
          ? {
              terminal: target.terminal,
              status: "would-restart",
              message: `${mode} appearance; ${target.status}; conversation is verified by native /status at restart`,
            }
          : await restart(runtime, target, continued);
      outcomes.push(outcome);
      report(outcome);
    }
    return outcomes;
  } catch (error) {
    const outcome: Outcome = {
      terminal: options.terminal ?? "*",
      status: "failed",
      message: errorMessage(error),
    };
    report(outcome);
    return [outcome];
  }
}

type Progress = Pick<
  RunEvent,
  "previous" | "mode" | "theme" | "action" | "panes"
>;

/** Fills `progress` as facts become known, so a thrown error still records them. */
async function run(options: Options, progress: Progress): Promise<boolean> {
  const mode = await appearance();
  progress.mode = mode;
  progress.theme = themeForAppearance(mode);
  const previous = await previousAppearance();
  progress.previous = previous ?? null;
  if (previous === mode && options.onChange) {
    progress.action = "unchanged";
    console.log(`Appearance remains ${mode}; no restarts`);
    return true;
  }
  if (previous === undefined && options.onChange) {
    progress.action = "initialized";
    if (!options.dryRun) await recordAppearance(mode);
    console.log(`Initialized ${mode} appearance; no restarts`);
    return true;
  }
  progress.action = "restart";
  // Record an event before side effects. A duplicate must not repeat a prompt
  // after a crash or uncertain CLI acknowledgement; explicit manual runs can retry.
  if (
    !options.dryRun &&
    !options.probeIdentities &&
    options.terminal === undefined
  )
    await recordAppearance(mode);
  const outcomes = await restartTerminals(options, mode);
  progress.panes = outcomes;
  console.log(`Appearance ${mode}: ${countsLine(countOutcomes(outcomes))}`);
  return succeeded(outcomes);
}

function emptyProgress(): Progress {
  return { previous: null, mode: null, theme: null, action: null, panes: [] };
}

/** Mirror a run to the macOS unified log; `logger -t` alone is not searchable there. */
async function mirror(event: RunEvent): Promise<void> {
  const priority = event.ok ? "user.notice" : "user.err";
  await command([
    loggerPath,
    "-t",
    logTag,
    "-p",
    priority,
    `${logTag}: ${summaryLine(event)}`,
  ]);
  for (const line of failureLines(event))
    await command([
      loggerPath,
      "-t",
      logTag,
      "-p",
      "user.err",
      `${logTag}: ${line}`,
    ]);
}

/** Every worker run, including one that throws, ends as exactly one event. */
async function work(options: Options): Promise<number> {
  const ts = new Date().toISOString();
  const progress = emptyProgress();
  let ok = false;
  let failure: string | null = null;
  let lock: Database | undefined;
  try {
    lock = await acquireLock();
    console.log(
      `\n${ts} ${options.onChange ? "Appearance event" : "Manual restart"}`,
    );
    // Read the actual appearance after acquiring the lock, so queued workers
    // converge on the latest system setting rather than replaying stale events.
    ok = await run(options, progress);
  } catch (error) {
    failure = errorMessage(error);
    console.error(failure);
  }
  const event: RunEvent = {
    ts,
    host: hostname(),
    trigger: triggerOf(options),
    terminal: options.terminal ?? null,
    ...progress,
    ok: ok && failure === null,
    error: failure,
    counts: countOutcomes(progress.panes),
  };
  try {
    await appendEvent(eventsPath, event);
  } finally {
    if (lock !== undefined) {
      lock.run("ROLLBACK");
      lock.close();
    }
  }
  await mirror(event);
  return event.ok ? 0 : 1;
}

async function codexConfigTheme(): Promise<string | undefined> {
  const file = Bun.file(path.join(homedir(), ".codex/config.toml"));
  if (!(await file.exists())) return undefined;
  const tui = object(Bun.TOML.parse(await file.text())).get("tui");
  if (tui === undefined) return undefined;
  const theme = object(tui).get("theme");
  return typeof theme === "string" ? theme : undefined;
}

async function liveTerminals(): Promise<TerminalProcess[]> {
  let addresses: string[];
  try {
    addresses = parseCodexTerminals(
      parseJson(await runtime.hc(["ls", "--json"])),
    );
  } catch (error) {
    return [{ terminal: "*", error: errorMessage(error) }];
  }
  return Promise.all(
    addresses.map(async (terminal): Promise<TerminalProcess> => {
      try {
        const snapshot = await snapshotOf(runtime, terminal);
        return { terminal, argv: snapshot.foreground.argv };
      } catch (error) {
        return { terminal, error: errorMessage(error) };
      }
    }),
  );
}

/** Read-only: never writes state, sends keys, or logs. */
async function status(): Promise<number> {
  const summary = statusReport({
    last: await readLastEvent(eventsPath),
    recorded: await previousAppearance(),
    current: await appearance(),
    configTheme: await codexConfigTheme(),
    terminals: await liveTerminals(),
  });
  for (const line of summary.lines) console.log(line);
  return summary.ok ? 0 : 1;
}

const usage = `Usage: restart-codex-panes [--dry-run | --probe-identities | --on-change | --status] [--terminal ADDRESS]
Restart each local Codex terminal so its \`codex\` wrapper relaunches it with the
theme for the current macOS appearance.
  (none)              restart now in an independent worker
  --on-change         restart only when the appearance differs from the last recorded one
  --dry-run           read-only preview of eligible terminals
  --probe-identities  query native /status in each terminal without restarting
  --status            read-only report: last run, recorded vs current appearance,
                      and each live local Codex terminal's launch theme; exits 1 on
                      any mismatch or a failed last run
  --terminal ADDRESS  restrict a manual run to one hc address such as t7
Each worker run appends one JSON line to ${eventsPath}
and mirrors its summary to the unified log:
  /usr/bin/log show --last 1d --style compact --predicate 'eventMessage CONTAINS "${logTag}"'`;

async function main(): Promise<number> {
  if (process.argv.includes("--help")) {
    console.log(usage);
    return 0;
  }
  const options = parseOptions(process.argv.slice(2));
  if (process.platform !== "darwin")
    throw new Error("Codex theme restarts require macOS");
  if (options.status) return status();
  if (options.dryRun) {
    const ok = await run(options, emptyProgress());
    return ok ? 0 : 1;
  }
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  if (options.worker) return work(options);
  // The worker records its own result; nothing is left to read its output.
  const child = spawn(
    process.execPath,
    [import.meta.path, ...process.argv.slice(2), "--worker"],
    {
      cwd: homedir(),
      env: commandEnvironment(),
      detached: true,
      stdio: "ignore",
    },
  );
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  console.log(
    `Restart worker ${String(child.pid)} started. Results: ${eventsPath} (summarize with --status)`,
  );
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
