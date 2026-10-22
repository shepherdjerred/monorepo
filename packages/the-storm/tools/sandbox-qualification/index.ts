/**
 * bun run qualify:sandbox --report <file> \
 *   --server-image docker.io/shepherdjerred/the-storm-server@sha256:<digest> \
 *   --source-revision <sha> --suite e2e --suite full
 *
 * See qualify.ts for the contract and the README for the report schema.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RconClient } from "#e2e/harness/rcon.ts";
import {
  main,
  packageRoot,
  SUITES,
  type SuiteRun,
  type SuiteTarget,
} from "./qualify.ts";

/** A world-scoped marker: present only after a qualification run claimed the server. */
const CLAIM_OBJECTIVE = "storm_qualified";
const KILL_GRACE_MS = 30_000;

/**
 * Claims a freshly booted server for one suite run. The scoreboard objective
 * lives in the world's saved data, so a server (or a restart over the same
 * data) that already served a run refuses a second claim.
 */
async function claimServer(target: SuiteTarget): Promise<void> {
  const { server } = target.external;
  const rcon = await RconClient.connect({
    host: server.host,
    port: server.rconPort,
    password: server.rconPassword,
  });
  try {
    const reply = await rcon.command(
      `minecraft:scoreboard objectives add ${CLAIM_OBJECTIVE} dummy`,
    );
    if (/already exists/iu.test(reply))
      throw new Error(
        `${server.host}:${server.gamePort.toString()} already served a qualification run; each suite needs a freshly booted server`,
      );
    if (!/created new objective/iu.test(reply))
      throw new Error(
        `Unexpected reply while claiming ${server.host}: ${reply.trim()}`,
      );
  } finally {
    rcon.close();
  }
}

let running: number | undefined;

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH"))
      throw error;
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    if (running !== undefined) killGroup(running, "SIGKILL");
    process.exit(signal === "SIGINT" ? 130 : 143);
  });

/** Runs the suite's package script with Vitest's JSON reporter beside the default one. */
async function runSuite(
  target: SuiteTarget,
  timeoutMs: number,
): Promise<SuiteRun> {
  const directory = await mkdtemp(path.join(tmpdir(), "storm-qualify-"));
  const reportFile = path.join(directory, `${target.suite}.vitest.json`);
  try {
    // Its own process group, so the ceiling stops the script's shell, Vitest
    // and its workers together.
    const child = spawn(
      process.execPath,
      [
        "run",
        SUITES[target.suite].script,
        "--reporter=default",
        "--reporter=json",
        `--outputFile.json=${reportFile}`,
      ],
      {
        cwd: packageRoot,
        env: target.env,
        stdio: ["ignore", "inherit", "inherit"],
        detached: true,
      },
    );
    const pid = child.pid;
    if (pid === undefined) throw new Error("bun run did not start");
    running = pid;
    const state = { timedOut: false };
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        resolve(code);
      });
    });
    const ceiling = setTimeout(() => {
      state.timedOut = true;
      killGroup(pid, "SIGTERM");
      setTimeout(() => {
        killGroup(pid, "SIGKILL");
      }, KILL_GRACE_MS).unref();
    }, timeoutMs);
    const exitCode = await exited;
    clearTimeout(ceiling);
    running = undefined;
    const json = Bun.file(reportFile);
    if (state.timedOut)
      return { exitCode: null, timedOut: true, vitestJson: null };
    const vitestJson: unknown = (await json.exists())
      ? await json.json()
      : null;
    return { exitCode, timedOut: false, vitestJson };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

process.exitCode = await main(Bun.argv.slice(2), Bun.env, {
  now: () => new Date(),
  claimServer,
  runSuite,
  log: (line) => {
    console.warn(line);
  },
});
