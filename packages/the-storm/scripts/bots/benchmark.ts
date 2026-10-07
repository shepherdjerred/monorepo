import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { DuelClient, DuelState } from "#learning/duels.ts";
import { frozenManifest, openPaperDuels, root } from "#learning/sandbox.ts";

const args = parseArgs({
  options: {
    matches: { type: "string", default: "100" },
    seed: { type: "string", default: "17000" },
    output: { type: "string" },
    probe: { type: "boolean", default: false },
  },
  strict: true,
});
const matches = z.coerce
  .number()
  .int()
  .min(2)
  .max(1000)
  .refine((n) => n % 2 === 0, "matches must be even")
  .parse(args.values.matches);
const firstSeed = z.coerce
  .number()
  .int()
  .min(0)
  .max(1_000_000_000)
  .parse(args.values.seed);
const out = path.resolve(
  args.values.output ??
    path.join(
      root,
      ".cache/rwf-benchmark",
      new Date().toISOString().replaceAll(":", "-"),
    ),
);
await mkdir(path.dirname(out), { recursive: true });
await mkdir(out, { recursive: false });
await Bun.write(
  path.join(out, "manifest.json"),
  JSON.stringify(
    {
      version: 1,
      matches,
      firstSeed,
      ...(await frozenManifest()),
      candidate: "authored Trooper, skill 1, no habits, authored healing",
      opponent:
        "basic: instant LOS aim, 10 CPS, sprint close to 2.3..2.7, strafe reversal every 20 ticks, no healing or jumping",
      sides: "paired red/blue",
      spawn: { red: [25.5, 65, 8.5], blue: [37.5, 65, 8.5] },
    },
    null,
    2,
  ),
);
let owner: Awaited<ReturnType<typeof openPaperDuels>> | undefined;
try {
  owner = await openPaperDuels(out);
  const duels = owner.duels;
  await duels.waitFor((state) => state.phase === "LOBBY", 90_000);
  if (args.values.probe) {
    const proof = await probe(duels);
    await Bun.write(
      path.join(out, "bridge-proof.json"),
      JSON.stringify(proof, null, 2),
    );
    console.warn(
      "Paper bridge: accepted actions, rejected stale/context actions, and restored authored control after timeout",
    );
  }
  const results: DuelState[] = [];
  for (let index = 0; index < matches; index++) {
    await duels.waitFor((state) => state.phase === "LOBBY", 30_000);
    const side = index % 2 === 0 ? "red" : "blue";
    const seed = firstSeed + Math.floor(index / 2);
    await duels.command(`begin ${seed.toString()} ${side} authored`);
    await duels.waitFor((state) => state.result === "live", 15_000);
    const terminal = await duels.waitFor(
      (state) => !["live", "waiting"].includes(state.result),
      75_000,
    );
    results.push(terminal);
    await Bun.write(
      path.join(out, "results.json"),
      JSON.stringify(results, null, 2),
    );
    console.warn(
      `${(index + 1).toString()}/${matches.toString()} ${side} seed ${seed.toString()}: ${terminal.result}, damage ${terminal.dealt.toFixed(2)} / ${terminal.received.toFixed(2)}, ticks ${(terminal.elapsed ?? 0).toString()}`,
    );
  }
  const wins = results.filter((state) => state.result === "win").length;
  const report = {
    trials: matches,
    wins,
    nonWins: matches - wins,
    losses: results.filter((state) => state.result === "loss").length,
    draws: results.filter((state) => state.result === "draw").length,
    timeouts: results.filter((state) => state.result === "timeout").length,
    stopped: results.filter((state) => state.result === "stopped").length,
    passed: matches === 100 && wins >= 80,
    bySide: ["red", "blue"].map((side) => ({
      side,
      wins: results.filter(
        (state) => state.side === side && state.result === "win",
      ).length,
      trials: results.filter((state) => state.side === side).length,
    })),
    dealt: results.reduce((sum, state) => sum + state.dealt, 0),
    received: results.reduce((sum, state) => sum + state.received, 0),
  };
  await Bun.write(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.warn(JSON.stringify(report));
  console.warn(`Evidence: ${out}`);
  if (matches === 100 && !report.passed) process.exitCode = 1;
} finally {
  await owner?.stop();
}

async function probe(duels: DuelClient): Promise<Record<string, unknown>> {
  await duels.command("begin 16999 red external");
  let context = await duels.waitFor(
    (state) => state.result === "live" && state.observation !== undefined,
    15_000,
  );
  const first = context;
  const stop = {
    move: 4,
    jump: false,
    sneak: false,
    sprint: false,
    attack: false,
  };
  const rejected: string[] = [];
  for (const command of [
    `act ${context.match} 00000000-0000-0000-0000-000000000000 ${context.life?.toString() ?? "0"} ${context.tick?.toString() ?? "0"} 4 0 0 0 0`,
    `act ${context.match} ${context.body ?? ""} 999999 ${context.tick?.toString() ?? "0"} 4 0 0 0 0`,
  ]) {
    try {
      await duels.command(command);
      throw new Error("wrong-context action accepted");
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message === "wrong-context action accepted"
      )
        throw error;
      rejected.push(error.message);
    }
  }
  context = await duels.command("state");
  for (let index = 0; index < 12; index++) {
    await duels.action(context, stop);
    await Bun.sleep(50);
    context = await duels.command("state");
  }
  const before = context;
  await Bun.sleep(200);
  const after = await duels.command("state");
  try {
    await duels.action(first, stop);
    throw new Error("expired action accepted");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message === "expired action accepted"
    )
      throw error;
    rejected.push(error.message);
  }
  if (after.applied < 5 || after.fallback <= before.fallback)
    throw new Error("action application or timeout fallback failed");
  await duels.command("cancel");
  try {
    await duels.action(before, stop);
    throw new Error("ended duel action accepted");
  } catch (error) {
    rejected.push(terminalRace(error));
  }
  await duels.waitFor((state) => state.phase === "LOBBY", 30_000);
  return { first, before, after, rejected };
}

function terminalRace(error: unknown): string {
  if (!(error instanceof Error) || error.message !== "duel no longer live")
    throw error;
  return error.message;
}
