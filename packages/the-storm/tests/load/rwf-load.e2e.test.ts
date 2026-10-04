import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect } from "vitest";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import type { Bot } from "mineflayer";
import { test } from "#e2e/fixtures.ts";
import { connectBot, disconnectBot } from "#e2e/harness/bot.ts";
import { docker } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { packageRoot } from "#e2e/harness/paths.ts";
import {
  eventually,
  status,
  transcript,
  waitForLobby,
} from "#e2e/harness/rwf-match.ts";
import type { ServerInfo } from "#e2e/harness/server.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

/**
 * The rwfbots load test (`bun run test:load`): one human joins a match, the
 * countdown fills it with bots and `/rwf admin loadtest` tops it up to N, and
 * the server is sampled while the match is live: Paper's `mspt` every second,
 * spark's tick percentiles, the process CPU and `/rwfbots debug` every ten
 * seconds. A match that ends early is re-armed until the phase has its full
 * measuring time. The 0-bot baseline is the same server with the human online
 * and no match running.
 *
 * The server runs on the production pod's limits (loadResources: 4 CPUs, an
 * 8G heap, a 10g limit). spark's report and the overview of 100 bots do not
 * fit an RCON reply, so they are sent to the console pipe and read back from
 * the container log. Results are printed as a table and written under
 * .cache/e2e/load for plugin/modules/rwfbots/LOAD.md.
 */

const botCounts = [20, 50, 100] as const;
const baselineMs = 90_000;
const settleMs = 20_000;
const measureMs = 150_000;
/** Plan bars: added p95 tick time at 100 bots, decision staleness, governor. */
const bars = { addedP95Ms: 8, stalenessP95Ticks: 3, governorLevel: 0 };

type Window = {
  p95: number;
  median: number;
  max: number;
  cpu: number;
  level: number;
  thinkP95: number;
  stalenessP95: number;
  sectionsP95: number;
  alive: number;
};
type Phase = {
  bots: number;
  mspt: number[];
  windows: Window[];
  matches: number;
};

function containerId(server: ServerInfo): string {
  if (server.kind !== "container") {
    throw new Error(
      "the load test boots its own container; run bun run test:load",
    );
  }
  return server.containerId;
}

/** The console log carries ANSI colour codes. */
const ansi = new RegExp(String.raw`${String.fromCodePoint(27)}\[[\d;]*m`, "gu");

function stripAnsi(text: string): string {
  return text.replaceAll(ansi, "");
}

/**
 * Sends `commands` to the server console and returns the log lines since,
 * once `answered` holds for them (spark answers off the main thread).
 */
async function viaConsole(
  server: ServerInfo,
  commands: string[],
  answered: (lines: string[]) => boolean,
): Promise<string[]> {
  const id = containerId(server);
  const since = (Date.now() / 1000 - 1).toFixed(3);
  for (const command of commands) {
    await docker(["exec", "-u", "1000", id, "mc-send-to-console", command]);
  }
  const deadline = Date.now() + 10_000;
  for (;;) {
    await Bun.sleep(500);
    const { stdout, stderr } = await docker(["logs", "--since", since, id]);
    const lines = stripAnsi(`${stdout}\n${stderr}`).split("\n");
    if (answered(lines) || Date.now() > deadline) {
      return lines;
    }
  }
}

const sparkTicks = /⚡\]\s+[\d.]+\/[\d.]+\/[\d.]+\/[\d.]+;/u;

/** spark's last-10 s tick durations: min/med/95%ile/max, before the 1 m ones. */
const TicksSchema = z.string().transform((line, context) => {
  const match =
    /(?<min>[\d.]+)\/(?<med>[\d.]+)\/(?<p95>[\d.]+)\/(?<max>[\d.]+);/u.exec(
      line,
    );
  if (match?.groups === undefined) {
    context.addIssue({
      code: "custom",
      message: `no tick durations in ${line}`,
    });
    return z.NEVER;
  }
  return {
    median: Number(match.groups["med"]),
    p95: Number(match.groups["p95"]),
    max: Number(match.groups["max"]),
  };
});

const DebugSchema = z.string().transform((line, context) => {
  const match =
    /governor level (?<level>\d+); think p95 (?<think>[\d.]+) ms .*staleness p95 (?<stale>[\d.]+) ticks; bot sections p95 (?<sections>[\d.]+) ms/u.exec(
      line,
    );
  if (match?.groups === undefined) {
    context.addIssue({ code: "custom", message: `no overview in ${line}` });
    return z.NEVER;
  }
  return {
    level: Number(match.groups["level"]),
    thinkP95: Number(match.groups["think"]),
    stalenessP95: Number(match.groups["stale"]),
    sectionsP95: Number(match.groups["sections"]),
  };
});

/** One ten-second window: spark's tick percentiles, CPU, the bots' overview. */
async function window(server: ServerInfo): Promise<Window> {
  const lines = await viaConsole(
    server,
    ["spark tps", "rwfbots debug", "rwf who"],
    (seen) =>
      seen.some((line) => sparkTicks.test(line)) &&
      seen.some((line) => line.includes("(process)")) &&
      seen.some((line) => line.includes("governor level")),
  );
  // spark answers asynchronously, so its lines interleave with the others:
  // the 10 s and 1 m durations are the only "a/b/c/d;" line it prints.
  const ticks = TicksSchema.parse(
    lines.findLast((line) => sparkTicks.test(line)) ?? "",
  );
  const cpuLine =
    lines.findLast(
      (line) => line.includes("⚡") && line.includes("(process)"),
    ) ?? "";
  const cpu = Number(/(?<cpu>[\d.]+)%/u.exec(cpuLine)?.groups?.["cpu"] ?? "0");
  const overview = DebugSchema.parse(
    lines.findLast((line) => line.includes("governor level")) ?? "",
  );
  const teams = lines.filter((line) =>
    /\[RWF\]: (?:Red|Blue) Team: /u.test(line),
  );
  const fighters = teams.flatMap((line) =>
    (line.split(" Team: ")[1] ?? "").split(", "),
  );
  const alive = fighters.filter(
    (fighter) => fighter.includes("✦") && !fighter.includes("(out)"),
  ).length;
  return { ...ticks, cpu, ...overview, alive };
}

const MsptSchema = z.string().transform((text, context) => {
  const match = /◴ (?<avg>[\d.]+)\/(?<min>[\d.]+)\/(?<max>[\d.]+),/u.exec(
    text.replaceAll(/§./gu, ""),
  );
  if (match?.groups === undefined) {
    context.addIssue({ code: "custom", message: `no mspt in ${text}` });
    return z.NEVER;
  }
  return Number(match.groups["avg"]);
});

/**
 * A fresh human joins (a player whose restored belongings are still being
 * saved may not join again until they reconnect) and the countdown is topped
 * up to `bots`; resolves with the human once the match is live.
 */
async function arm(
  server: ServerInfo,
  rcon: RconClient,
  bots: number,
): Promise<Bot> {
  await waitForLobby(rcon);
  const human = await connectBot({
    host: server.host,
    port: server.gamePort,
    username: `load_${randomBytes(4).toString("hex")}`,
  });
  const log = transcript(human);
  human.chat("/rwf join");
  try {
    await eventually("the countdown", async () => phaseIs(rcon, "Countdown"));
  } catch (error) {
    await disconnectBot(human);
    throw new Error(
      `${String(error)}; the human saw:\n${log.lines.join("\n")}`,
      {
        cause: error,
      },
    );
  }
  for (;;) {
    const now = await status(rcon);
    if (now.bots >= bots || now.phase !== "Countdown") {
      break;
    }
    await rcon.command(
      `rwf admin loadtest ${Math.min(100, bots - now.bots).toString()}`,
    );
  }
  await eventually(
    "the match to go live",
    async () => phaseIs(rcon, "Live"),
    30_000,
  );
  const armed = await status(rcon);
  expect(armed.bots).toBe(bots);
  return human;
}

/** Whether the rwf match is in `phase`. */
async function phaseIs(rcon: RconClient, phase: string): Promise<boolean> {
  const now = await status(rcon);
  return now.phase === phase;
}

/**
 * A match that can end mid-measurement: `live` says whether it is still
 * running and `rearm` starts the next one.
 */
type MatchLoop = {
  live: () => Promise<boolean>;
  rearm: () => Promise<void>;
};

/** Samples for `durationMs` of time in which the match (if any) is live. */
async function measure(
  server: ServerInfo,
  rcon: RconClient,
  durationMs: number,
  match?: MatchLoop,
): Promise<Omit<Phase, "bots">> {
  const phase: Omit<Phase, "bots"> = { mspt: [], windows: [], matches: 1 };
  let measured = 0;
  let sinceWindow = 0;
  while (measured < durationMs) {
    if (match !== undefined && !(await match.live())) {
      await match.rearm();
      phase.matches++;
      await Bun.sleep(settleMs);
      sinceWindow = 0;
      continue;
    }
    const started = Date.now();
    phase.mspt.push(MsptSchema.parse(await rcon.command("mspt")));
    if (sinceWindow >= 10_000) {
      phase.windows.push(await window(server));
      sinceWindow = 0;
    }
    await Bun.sleep(Math.max(0, 1000 - (Date.now() - started)));
    const elapsed = Date.now() - started;
    measured += elapsed;
    sinceWindow += elapsed;
  }
  return phase;
}

const mean = (values: number[]) =>
  values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
const max = (values: number[]) => Math.max(0, ...values);

function summarise(phase: Phase) {
  return {
    bots: phase.bots,
    matches: phase.matches,
    aliveMean: mean(phase.windows.map((w) => w.alive)),
    msptAvg: mean(phase.mspt),
    p95: mean(phase.windows.map((w) => w.p95)),
    p95Worst: max(phase.windows.map((w) => w.p95)),
    msptMax: max(phase.windows.map((w) => w.max)),
    cpu: mean(phase.windows.map((w) => w.cpu)),
    thinkP95: max(phase.windows.map((w) => w.thinkP95)),
    sectionsP95: max(phase.windows.map((w) => w.sectionsP95)),
    stalenessP95: max(phase.windows.map((w) => w.stalenessP95)),
    level: max(phase.windows.map((w) => w.level)),
    windows: phase.windows.length,
  };
}

const fixed = (value: number) => value.toFixed(1);

describe("rwfbots load", () => {
  test(
    "added tick time, decision staleness and the governor at 20, 50 and 100 bots",
    { timeout: 45 * 60_000 },
    async ({ bot, rcon, server }) => {
      // The baseline has a player online, as every phase does.
      expect(bot.username).not.toBe("");
      await waitForLobby(rcon);
      const baseline = await measure(server, rcon, baselineMs);
      const phases: Phase[] = [{ bots: 0, ...baseline, matches: 0 }];
      for (const bots of botCounts) {
        let human = await arm(server, rcon, bots);
        await Bun.sleep(settleMs);
        const sampled = await measure(server, rcon, measureMs, {
          live: async () => phaseIs(rcon, "Live"),
          rearm: async () => {
            await disconnectBot(human);
            human = await arm(server, rcon, bots);
          },
        });
        phases.push({ bots, ...sampled });
        // The human leaving stops the match; the next phase starts afresh.
        await disconnectBot(human);
        await waitForLobby(rcon);
      }

      const rows = phases.map((phase) => summarise(phase));
      const base = rows[0]?.p95 ?? 0;
      const table = [
        "| Bots | Matches | Alive (mean) | MSPT avg | MSPT p95 | Added p95 | Worst 10 s p95 | MSPT max | CPU % | Think p95 ms | Bot sections p95 ms | Staleness p95 ticks | Governor |",
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ...rows
          .map((row) =>
            [
              row.bots,
              row.matches,
              fixed(row.aliveMean),
              fixed(row.msptAvg),
              fixed(row.p95),
              fixed(row.p95 - base),
              fixed(row.p95Worst),
              fixed(row.msptMax),
              fixed(row.cpu),
              row.thinkP95.toFixed(2),
              row.sectionsP95.toFixed(2),
              fixed(row.stalenessP95),
              row.level,
            ].join(" | "),
          )
          .map((line) => `| ${line} |`),
      ].join("\n");
      console.warn(`\n${table}\n`);
      const outDir = path.join(packageRoot, ".cache", "e2e", "load");
      await mkdir(outDir, { recursive: true });
      await Bun.write(
        path.join(outDir, `rwf-load-${new Date().toISOString()}.json`),
        JSON.stringify({ rows, phases, table }, null, 2),
      );

      // The plan's bars; every one is checked so the table is complete even
      // when one fails.
      const hundred = rows.find((row) => row.bots === 100);
      expect
        .soft(
          (hundred?.p95 ?? Number.POSITIVE_INFINITY) - base,
          "added p95 MSPT at 100 bots",
        )
        .toBeLessThanOrEqual(bars.addedP95Ms);
      expect
        .soft(hundred?.level, "governor level at 100 bots")
        .toBe(bars.governorLevel);
      for (const row of rows.filter((candidate) => candidate.bots > 0)) {
        expect
          .soft(
            row.stalenessP95,
            `decision staleness p95 at ${row.bots.toString()} bots`,
          )
          .toBeLessThanOrEqual(bars.stalenessP95Ticks);
      }
    },
  );
});
