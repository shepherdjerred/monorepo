import { mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Bot } from "mineflayer";
import { expect } from "vitest";
import { z } from "zod";
import { test } from "#e2e/fixtures.ts";
import { capacityMap, capacityResources } from "#e2e/gameplay-fixtures.ts";
import { packageRoot } from "#e2e/harness/paths.ts";
import { connectBot, disconnectBot } from "#e2e/harness/bot.ts";
import { eventually, status, transcript } from "#e2e/harness/rwf-match.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";
import type { ServerInfo } from "#e2e/harness/server.ts";
import { sampleWindow, MsptSchema } from "#load/samples.ts";
import {
  capacityVerdicts,
  totals,
  type CapacityPhase,
} from "./capacity-bars.ts";
import {
  drainTelemetry,
  evidence,
  lifecycle,
  memory,
  telemetry,
  profileAfterMeasurement,
} from "./probes.ts";

const baselineMs = 90_000;
const settleMs = 20_000;
const measureMs = 150_000;
const readyMs = 15 * 60_000;

async function lobby(rcon: RconClient) {
  await eventually(
    "the imported map and lobby to finish preparing",
    async () => {
      const reply = await rcon.command("rwf admin status");
      if (!reply.includes("Ready: true, phase: Lobby")) return false;
      const now = await status(rcon);
      return now.humans === 0;
    },
    readyMs,
  );
  expect(await rcon.command("rwfbots debug")).toContain("no bots in the match");
}

async function arm(
  server: ServerInfo,
  rcon: RconClient,
  total: number,
): Promise<{ human: Bot; match: CapacityPhase["matches"][number] }> {
  await lobby(rcon);
  await rcon.command("rwfbots debug reset");
  const teams = capacityMap() === "apex-expanse" ? 2 : 4;
  const preference = await rcon.command(
    `rwf admin size team ${(total / teams).toString()}`,
  );
  expect(preference).toContain(`${total.toString()} total`);
  const human = await connectBot({
    host: server.host,
    port: server.gamePort,
    username: `cap_${randomBytes(4).toString("hex")}`,
  });
  const chat = transcript(human);
  const began = Date.now();
  try {
    human.chat("/rwf join");
    const arrival = await lifecycle(server, async () => isLive(rcon), 120_000);
    const now = await status(rcon);
    expect(now.humans).toBe(1);
    expect(now.bots).toBe(total - 1);
    return {
      human,
      match: {
        id: now.matchId,
        humans: 1 as const,
        bots: now.bots,
        arrivalMs: Date.now() - began,
        arrival,
        startup: await telemetry(rcon),
      },
    };
  } catch (error) {
    await disconnectBot(human);
    throw new Error(
      `Capacity draft failed: ${String(error)}; chat: ${chat.lines.join("\n")}`,
      { cause: error },
    );
  }
}

async function cleanup(human: Bot, server: ServerInfo, rcon: RconClient) {
  await disconnectBot(human);
  return lifecycle(
    server,
    async () => {
      const reply = await rcon.command("rwf admin status");
      if (!reply.includes("Ready: true, phase: Lobby")) return false;
      const now = await status(rcon);
      const debug = await rcon.command("rwfbots debug");
      return now.humans === 0 && debug.includes("no bots in the match");
    },
    readyMs,
  );
}

async function baseline(
  server: ServerInfo,
  rcon: RconClient,
): Promise<CapacityPhase> {
  const phase: CapacityPhase = {
    total: 0,
    measuredMs: 0,
    mspt: [],
    windows: [],
    telemetry: [],
    memory: [],
    matches: [],
  };
  const began = Date.now();
  let nextWindow = began + 10_000;
  while (Date.now() - began < baselineMs) {
    const tick = Date.now();
    phase.mspt.push(MsptSchema.parse(await rcon.command("mspt")));
    phase.memory.push(await memory(server));
    if (Date.now() >= nextWindow) {
      phase.windows.push(await sampleWindow(server));
      phase.telemetry.push(await telemetry(rcon));
      nextWindow = Date.now() + 10_000;
    }
    await Bun.sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  phase.measuredMs = Date.now() - began;
  return phase;
}

async function isLive(rcon: RconClient): Promise<boolean> {
  const now = await status(rcon);
  return now.phase === "Live";
}

async function liveWindow(
  server: ServerInfo,
  rcon: RconClient,
  phase: CapacityPhase,
  checkpoint: () => Promise<void>,
) {
  let nextWindow = Date.now() + 10_000;
  while (phase.measuredMs < measureMs && (await isLive(rcon))) {
    const started = Date.now();
    const mspt = MsptSchema.parse(await rcon.command("mspt"));
    const mem = await memory(server);
    const due = Date.now() >= nextWindow;
    const sampled = due ? await sampleWindow(server) : undefined;
    const diagnostics = due ? await drainTelemetry(rcon) : undefined;
    await Bun.sleep(Math.max(0, 1000 - (Date.now() - started)));
    if (!(await isLive(rcon))) break;
    const elapsed = Date.now() - started;
    phase.measuredMs += elapsed;
    phase.mspt.push(mspt);
    phase.memory.push(mem);
    if (sampled !== undefined && diagnostics !== undefined) {
      phase.windows.push(sampled);
      phase.telemetry.push(diagnostics);
      await checkpoint();
      nextWindow += 10_000;
    }
  }
  const final = await telemetry(rcon);
  if (final.observations > 0) phase.telemetry.push(final);
}

async function measure(
  server: ServerInfo,
  rcon: RconClient,
  phase: CapacityPhase,
  checkpoint: () => Promise<void>,
) {
  while (phase.measuredMs < measureMs) {
    const armed = await arm(server, rcon, phase.total);
    phase.matches.push(armed.match);
    try {
      await Bun.sleep(settleMs);
      armed.match.startup = await telemetry(rcon);
      if (await isLive(rcon)) {
        await rcon.command("rwfbots debug reset");
        await liveWindow(server, rcon, phase, checkpoint);
        if (phase.measuredMs >= measureMs && (await isLive(rcon)))
          await profileAfterMeasurement(server, armed.match.id);
      }
    } finally {
      await checkpoint();
      armed.match.reset = await cleanup(armed.human, server, rcon);
      armed.match.resetMs = armed.match.reset.elapsedMs;
      armed.match.resetTelemetry = await telemetry(rcon);
      await checkpoint();
    }
  }
}

test(
  "100, 128, 192 and 256 mixed combatants on the measured CPU budget",
  { timeout: 90 * 60_000 },
  async ({ bot, rcon, server }) => {
    expect(bot.username).not.toBe("");
    await lobby(rcon);
    const inputs = await evidence(server);
    const probe = Bun.env["STORM_CAPACITY_PROBE_TOTAL"];
    if (probe === undefined) expect(inputs.personalityCount).toBe(512);
    const outDir = path.join(packageRoot, ".cache/e2e/capacity");
    await mkdir(outDir, { recursive: true });
    const file = path.join(
      outDir,
      `${capacityMap()}-${new Date().toISOString()}.json`,
    );
    const phases: CapacityPhase[] = [];
    const checkpoint = async () => {
      await Bun.write(
        file,
        JSON.stringify(
          {
            map: capacityMap(),
            inputs,
            resources: capacityResources(),
            rayBudget: Bun.env["STORM_CAPACITY_RAY_BUDGET"] ?? "shipped",
            profile: Bun.env["STORM_CAPACITY_PROFILE"] ?? "none",
            phases,
            verdicts: capacityVerdicts(phases),
          },
          null,
          2,
        ),
      );
    };
    phases.push(await baseline(server, rcon));
    await checkpoint();
    // A calibration run remains a failed release matrix until all four phases are present.
    const measuredTotals =
      probe === undefined
        ? totals
        : [z.enum(["100", "128", "192", "256"]).transform(Number).parse(probe)];
    for (const total of measuredTotals) {
      const phase: CapacityPhase = {
        total,
        measuredMs: 0,
        mspt: [],
        windows: [],
        telemetry: [],
        memory: [],
        matches: [],
      };
      phases.push(phase);
      console.warn(
        `[capacity] ${capacityMap()} ${total.toString()} total; checkpoint ${file}`,
      );
      await measure(server, rcon, phase, checkpoint);
    }
    const verdicts = capacityVerdicts(phases);
    console.warn(verdicts);
    for (const verdict of verdicts)
      expect.soft(verdict.pass, verdict.check).toBe(true);
  },
);
