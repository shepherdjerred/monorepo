import { loadavg } from "node:os";
import { z } from "zod";
import { docker } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import type { ServerInfo } from "#e2e/harness/server.ts";
import { WindowSchema, type Window } from "./load-bars.ts";

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
export async function sampleWindow(server: ServerInfo): Promise<Window> {
  const lines = await viaConsole(
    server,
    ["spark tps", "rwfbots debug", "rwf who"],
    (seen) =>
      seen.some((line) => sparkTicks.test(line)) &&
      seen.some((line) => line.includes("(process)")) &&
      seen.some((line) => line.includes("governor level")) &&
      seen.some((line) => line.includes("board tick")),
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
  const cpu = Number(
    /(?<cpu>[\d.]+)%/u.exec(cpuLine)?.groups?.["cpu"] ?? Number.NaN,
  );
  const overview = DebugSchema.parse(
    lines.findLast((line) => line.includes("governor level")) ?? "",
  );
  const teams = lines.filter((line) => /\[RWF\]: \w+ Team: /u.test(line));
  const fighters = teams.flatMap((line) =>
    (line.split(" Team: ")[1] ?? "").split(", "),
  );
  const alive = fighters.filter(
    (fighter) => fighter.includes("✦") && !fighter.includes("(out)"),
  ).length;
  const boardLine = lines.findLast((line) => line.includes("board tick")) ?? "";
  const deferred = Number(
    /(?<deferred>\d+) deferred/u.exec(boardLine)?.groups?.["deferred"] ??
      Number.NaN,
  );
  const boardTick = Number(
    /board tick (?<tick>\d+)/u.exec(boardLine)?.groups?.["tick"] ?? Number.NaN,
  );
  const tickerTick = Number(
    /; tick (?<tick>\d+)/u.exec(
      lines.findLast((line) => line.includes("governor level")) ?? "",
    )?.groups?.["tick"] ?? Number.NaN,
  );
  const boardLag = tickerTick - boardTick;
  const [hostLoad = Number.NaN] = loadavg();
  return WindowSchema.parse({
    ...ticks,
    cpu,
    ...overview,
    alive,
    boardLag,
    deferred,
    hostLoad,
  });
}

export const MsptSchema = z.string().transform((text, context) => {
  const match = /◴ (?<avg>[\d.]+)\/(?<min>[\d.]+)\/(?<max>[\d.]+),/u.exec(
    text.replaceAll(/§./gu, ""),
  );
  if (match?.groups === undefined) {
    context.addIssue({ code: "custom", message: `no mspt in ${text}` });
    return z.NEVER;
  }
  return Number(match.groups["avg"]);
});
