#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  discover,
  errorMessage,
  object,
  restart,
  runningSessions,
  type Outcome,
  type Runtime,
} from "./codex_theme_restart_core.ts";
import {
  parseOptions,
  type Options,
  type Appearance,
} from "./codex_theme_restart_options.ts";
import {
  syncCodexAppearance,
  themeForAppearance,
} from "./codex_theme_restart_config.ts";

const stateDirectory = path.join(homedir(), ".local/state/codex-theme-restart");
const logPath = path.join(stateDirectory, "restart.log");
const statePath = path.join(stateDirectory, "appearance.json");

// In particular, do not retain a password-manager service token or another
// pane's socket/thread identity in this long-lived, independent worker.
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

function jsonResponse(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("Invalid JSON response from Herdr");
  }
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
      program === "herdr" ? args.slice(3, 5).join(" ") : path.basename(program);
    let code = "tooling_error";
    if (program === "herdr" && exitCode === 1) {
      const value = object(object(jsonResponse(stderr)).get("error")).get(
        "code",
      );
      if (typeof value !== "string" || !/^[a-z_]+$/.test(value))
        throw new TypeError("Invalid Herdr error code");
      code = value;
    }
    throw new Error(`${operation} failed: ${code} (exit ${String(exitCode)})`);
  }
  return stdout;
}

const runtime: Runtime = {
  async appearanceConfigured(mode) {
    const config = object(
      Bun.TOML.parse(
        await Bun.file(path.join(homedir(), ".codex/config.toml")).text(),
      ),
    );
    const tui = object(config.get("tui"));
    return (
      tui.get("theme") === themeForAppearance(mode) &&
      tui.get("resume_cwd") === "session"
    );
  },
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
  async call(session, args) {
    const output = await command(
      ["herdr", "--session", session, ...args],
      35_000,
    );
    // Hook reporting commands deliberately produce no response body. Their
    // effects are verified by the following structured pane read.
    if (
      args[0] === "pane" &&
      (args[1] === "report-agent-session" || args[1] === "send-text")
    )
      return {};
    if (args[0] === "pane" && args[1] === "read") return output;
    const response = jsonResponse(output);
    return object(response).get("result");
  },
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
  console.log(
    `${outcome.status}: ${outcome.session}/${outcome.pane}: ${outcome.message}`,
  );
}

async function processSession(
  options: Options,
  session: string,
  mode: Appearance,
  continued: Set<string>,
): Promise<Outcome[]> {
  try {
    const discovered = await discover(runtime, session, mode, {
      ...(options.pane === undefined ? {} : { pane: options.pane }),
      probe: !options.dryRun,
    });
    const outcomes = [...discovered.outcomes];
    for (const outcome of discovered.outcomes) report(outcome);
    for (const target of discovered.targets) {
      const outcome: Outcome = options.probeIdentities
        ? {
            session,
            pane: target.agent.pane,
            status: "identified",
            message: `Native /status verified conversation ${String(target.agent.thread)}; client left running`,
          }
        : options.dryRun
          ? {
              session,
              pane: target.agent.pane,
              status: "would-restart",
              message: `${mode} appearance; ${target.agent.status}; exact conversation identified`,
            }
          : await restart(runtime, target, continued);
      outcomes.push(outcome);
      report(outcome);
    }
    return outcomes;
  } catch (error) {
    const outcome: Outcome = {
      session,
      pane: options.pane ?? "*",
      status: "failed",
      message: errorMessage(error),
    };
    report(outcome);
    return [outcome];
  }
}

async function run(options: Options): Promise<number> {
  const mode = await appearance();
  const previous = await previousAppearance();
  if (previous === mode && options.onChange) {
    console.log(`Appearance remains ${mode}; no restarts`);
    return 0;
  }
  if (previous === undefined && options.onChange) {
    if (!options.dryRun) await recordAppearance(mode);
    console.log(`Initialized ${mode} appearance; no restarts`);
    return 0;
  }
  const sessions =
    options.session === undefined
      ? runningSessions(
          jsonResponse(await command(["herdr", "session", "list", "--json"])),
        )
      : [options.session];
  const outcomes: Outcome[] = [];
  if (!options.dryRun && !options.probeIdentities)
    await syncCodexAppearance(mode, path.join(homedir(), ".codex"));
  // Record an event before side effects. A duplicate must not repeat a prompt
  // after a crash or uncertain CLI acknowledgement; explicit manual runs can retry.
  if (
    !options.dryRun &&
    !options.probeIdentities &&
    options.session === undefined
  )
    await recordAppearance(mode);
  const continued = new Set<string>();
  for (const session of sessions) {
    outcomes.push(...(await processSession(options, session, mode, continued)));
  }
  const count = (status: Outcome["status"]) =>
    outcomes.filter((outcome) => outcome.status === status).length;
  console.log(
    `Appearance ${mode}: ${String(count("restarted"))} restarted, ${String(count("would-restart"))} eligible, ${String(count("identified"))} identified, ${String(count("skipped"))} skipped, ${String(count("failed"))} failed`,
  );
  return count("failed") > 0 || count("skipped") > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  if (process.argv.includes("--help")) {
    console.log(
      "Usage: restart-codex-panes [--dry-run | --probe-identities | --on-change] [--session NAME [--pane ID]]\nManual runs restart immediately; --on-change deduplicates appearance events.\n--dry-run is read-only; --probe-identities queries native /status without restarting.\nWorkers run independently and append results to " +
        logPath,
    );
    return 0;
  }
  const options = parseOptions(process.argv.slice(2));
  if (process.platform !== "darwin")
    throw new Error("Codex theme restarts require macOS");
  if (options.dryRun) return run(options);
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  if (!options.worker) {
    const log = await open(logPath, "a", 0o600);
    try {
      const child = spawn(
        process.execPath,
        [import.meta.path, ...process.argv.slice(2), "--worker"],
        {
          cwd: homedir(),
          env: commandEnvironment(),
          detached: true,
          stdio: ["ignore", log.fd, log.fd],
        },
      );
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
      console.log(
        `Restart worker ${String(child.pid)} started. Results: ${logPath}`,
      );
      return 0;
    } finally {
      await log.close();
    }
  }
  const lock = await acquireLock();
  try {
    console.log(
      `\n${new Date().toISOString()} ${options.onChange ? "Appearance event" : "Manual restart"}`,
    );
    // Read the actual appearance after acquiring the lock, so queued workers
    // converge on the latest system setting rather than replaying stale events.
    return await run(options);
  } finally {
    lock.run("ROLLBACK");
    lock.close();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
