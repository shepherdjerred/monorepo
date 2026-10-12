import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect } from "vitest";
import { randomBytes } from "node:crypto";
import type { Bot } from "mineflayer";
import { test } from "#e2e/fixtures.ts";
import { connectBot, disconnectBot } from "#e2e/harness/bot.ts";
import { packageRoot } from "#e2e/harness/paths.ts";
import { loadResources } from "#e2e/gameplay-fixtures.ts";
import { type Phase, summarise, verdicts } from "./load-bars.ts";
import { sampleWindow as window, MsptSchema } from "./samples.ts";
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

const fixed = (value: number) => value.toFixed(1);

describe("rwfbots load", () => {
  test(
    "added tick time, think-loop lag and the governor at 20, 50 and 100 bots",
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
      const { cpus } = loadResources();
      const base = rows[0]?.p95 ?? 0;
      const table = [
        "| Bots | Matches | Alive (mean) | MSPT avg | MSPT p95 | Added p95 | Worst 10 s p95 | MSPT max | CPU % | Think p95 ms | Overrun windows | Deferred max | Bot sections p95 ms | Decision age p95 ticks | Board lag p95 ticks | Board lag max ticks | Governor | Host load |",
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
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
              row.overruns,
              row.deferredMax,
              row.sectionsP95.toFixed(2),
              fixed(row.stalenessP95),
              row.boardLagP95,
              row.boardLagMax,
              row.level,
              fixed(row.hostLoad),
            ].join(" | "),
          )
          .map((line) => `| ${line} |`),
      ].join("\n");
      console.warn(`\n${cpus.toString()} CPUs\n${table}\n`);
      const outDir = path.join(packageRoot, ".cache", "e2e", "load");
      await mkdir(outDir, { recursive: true });
      await Bun.write(
        path.join(
          outDir,
          `rwf-load-${cpus.toString()}cpu-${new Date().toISOString()}.json`,
        ),
        JSON.stringify({ cpus, rows, phases, table }, null, 2),
      );

      // The plan's bars (load-bars.ts); every one is checked so the table is
      // complete even when one fails. Decision age is reported, not judged.
      for (const verdict of verdicts(rows)) {
        expect.soft(verdict.pass, verdict.check).toBe(true);
      }
    },
  );
});
