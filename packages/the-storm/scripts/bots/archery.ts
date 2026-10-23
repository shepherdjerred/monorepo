#!/usr/bin/env bun
/**
 * The archery report card: for every combatant on a bow, crossbow or trident
 * kit in one or more match recordings, their time alive, shots, shots per
 * minute alive, projectile hits on enemies and accuracy, and for bots on an
 * Infinity bow a PASS or FAIL against the bar in `archery-report.ts`. Limited
 * ammunition kits (crossbows, Fletcher, Harpooner) are reported but not judged.
 * Humans are listed as a reference and never judged.
 *
 *   bun run bots:archery <recording.rwfrec.gz | directory>... [--json]
 *
 * Exits 1 when any judged bot fails, and 2 when a judged bot's hits are
 * unknown because the recording predates hit events, so it can gate a bot
 * experiment (`bun run bots:match`, then this on its output directory).
 */
import { constants, gunzipSync } from "node:zlib";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  type Card,
  MIN_ACCURACY,
  MIN_HITS,
  MIN_JUDGED_SECONDS,
  MIN_SHOTS_PER_MINUTE,
  type Totals,
  cards,
  readMatch,
  recordsHits,
  totals,
} from "./archery-report.ts";

const ArgsSchema = z.object({
  paths: z.array(z.string().min(1)).nonempty(),
  json: z.boolean(),
});

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { json: { type: "boolean", default: false } },
});
const args = ArgsSchema.parse({ paths: positionals, json: values.json });

/** Every recording under `target`: the file itself, or each `*.rwfrec.gz` below a directory. */
async function recordings(target: string): Promise<string[]> {
  const info = await stat(target);
  if (!info.isDirectory()) return [target];
  const entries = await readdir(target, { recursive: true });
  return entries
    .filter((name) => name.endsWith(".rwfrec.gz"))
    .map((name) => path.join(target, name))
    .toSorted();
}

async function lines(file: string): Promise<string[]> {
  const text = new TextDecoder().decode(
    gunzipSync(await Bun.file(file).arrayBuffer(), {
      // A match stopped while live leaves its recording unterminated; read what was written.
      finishFlush: constants.Z_SYNC_FLUSH,
    }),
  );
  // Only complete lines: an unterminated recording can end part-way through one.
  return text.split("\n").slice(0, -1);
}

const found = await Promise.all(args.paths.map((target) => recordings(target)));
const files = found.flat();
if (files.length === 0) throw new Error("no *.rwfrec.gz recordings found");

type MatchReport = {
  file: string;
  match: string;
  map: string;
  minutes: number;
  ended: boolean;
  hitsRecorded: boolean;
  cards: Card[];
};

const reports: MatchReport[] = [];
for (const file of files) {
  const match = readMatch(await lines(file));
  reports.push({
    file,
    match: match.id,
    map: match.map,
    minutes: match.endTick / 20 / 60,
    ended: match.ended,
    hitsRecorded: recordsHits(match),
    cards: cards(match),
  });
}

const all = reports.flatMap((report) => report.cards);
const judgedBots = all.filter((card) => card.verdict !== "-");

const pct = (value: number | undefined) =>
  value === undefined ? "?" : `${(100 * value).toFixed(0)}%`;

function cardLine(card: Card): string {
  const ammo =
    card.kit.ammo === "finite"
      ? `${card.kit.arrows.toString()} arrows`
      : card.kit.ammo;
  const why = card.failures.length > 0 ? ` (${card.failures.join(", ")})` : "";
  return (
    `  ${card.verdict.padEnd(7)} ${(card.bot ? "bot" : "human").padEnd(5)} ` +
    `${card.pseudonym}  ${card.team.padEnd(6)} ${card.kit.id.padEnd(10)} ` +
    `${card.kit.weapon.padEnd(8)} ${ammo.padEnd(9)} ` +
    // "+" marks a member still alive at the end.
    `alive ${(card.secondsAlive / 60).toFixed(1).padStart(4)}${card.died ? " " : "+"} min  ` +
    `shots ${card.shots.toString().padStart(3)}  ` +
    `${card.shotsPerMinute.toFixed(1).padStart(4)}/min  ` +
    `hits ${(card.hits?.toString() ?? "?").padStart(3)}  ` +
    `acc ${pct(card.accuracy).padStart(4)}${why}`
  );
}

function totalsLine(label: string, sum: Totals): string {
  const verdicts =
    sum.judged > 0
      ? `  judged ${sum.judged.toString()}: ${sum.passed.toString()} pass, ` +
        `${sum.failed.toString()} fail${sum.unknown > 0 ? `, ${sum.unknown.toString()} unknown` : ""}`
      : "";
  return (
    `  ${label}: ${sum.members.toString()} ranged, ` +
    `${sum.minutesAlive.toFixed(1)} min alive, ${sum.shots.toString()} shots ` +
    `(${sum.shotsPerMinute.toFixed(1)}/min), hits ${sum.hits?.toString() ?? "?"}, ` +
    `acc ${pct(sum.accuracy)}${verdicts}`
  );
}

if (args.json) {
  await Bun.write(Bun.stdout, `${JSON.stringify(reports, null, 2)}\n`);
} else {
  const out: string[] = [
    `Bar for bots on Infinity bows alive >= ${MIN_JUDGED_SECONDS.toString()} s: ` +
      `>= ${MIN_HITS.toString()} projectile hit on an enemy, ` +
      `>= ${MIN_SHOTS_PER_MINUTE.toString()} shots/min alive, accuracy >= ${pct(MIN_ACCURACY)}.`,
  ];
  for (const report of reports) {
    out.push(
      "",
      `${report.match}  ${report.map}  ${report.minutes.toFixed(1)} min` +
        (report.ended ? "" : " (unterminated)") +
        (report.hitsRecorded
          ? ""
          : "  [no hit events: recording predates them]") +
        `  ${report.file}`,
      ...report.cards.map((card) => cardLine(card)),
    );
    const teams = Map.groupBy(report.cards, (card) => card.team);
    for (const [team, list] of [...teams].toSorted(([a], [b]) =>
      a.localeCompare(b),
    )) {
      out.push(
        totalsLine(
          `team ${team} bots`,
          totals(list.filter((card) => card.bot)),
        ),
      );
    }
    out.push(
      totalsLine("match bots", totals(report.cards.filter((card) => card.bot))),
    );
    const humans = report.cards.filter((card) => !card.bot);
    if (humans.length > 0) out.push(totalsLine("match humans", totals(humans)));
  }
  if (reports.length > 1) {
    out.push("", `All ${reports.length.toString()} recordings:`);
    const byKit = Map.groupBy(
      all.filter((card) => card.bot),
      (card) => card.kit.id,
    );
    for (const [kit, list] of [...byKit].toSorted(([a], [b]) =>
      a.localeCompare(b),
    )) {
      out.push(totalsLine(`bots on ${kit}`, totals(list)));
    }
    out.push(totalsLine("bots", totals(all.filter((card) => card.bot))));
    const humans = all.filter((card) => !card.bot);
    if (humans.length > 0) out.push(totalsLine("humans", totals(humans)));
  }
  await Bun.write(Bun.stdout, `${out.join("\n")}\n`);
}

if (judgedBots.some((card) => card.verdict === "FAIL")) process.exit(1);
if (judgedBots.some((card) => card.verdict === "UNKNOWN")) process.exit(2);
