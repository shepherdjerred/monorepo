#!/usr/bin/env bun
/**
 * Draws a Search and Destroy match recording from above: every combatant's
 * path, solid until first contact (the first landed sword blow or death) and faint
 * after it, over the map's spawns, bombs and nukes, with each team's
 * dispersion before first contact. Prints the same numbers as JSON.
 *
 *   bun run rwf:trails <recording.gz> --out <trails.png> [--label before]
 *
 * Recordings are the `.gz` files rwf writes per match (the full-lane suite
 * copies them under `.cache/e2e/rwf/<matchId>/`).
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { Resvg } from "@resvg/resvg-js";
import { z } from "zod";
import { ownedConfigDir } from "#e2e/harness/paths.ts";
import {
  advance,
  dispersion,
  readTrails,
  type TeamAdvance,
  type TeamDispersion,
  THIRD,
  type Trails,
} from "#e2e/harness/rwf-trails.ts";

const ArgsSchema = z.object({
  recording: z.string().min(1),
  out: z.string().endsWith(".png"),
  label: z.string().min(1),
});

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    label: { type: "string", default: "match" },
  },
});
const args = ArgsSchema.parse({ ...values, recording: positionals[0] });

const PointSchema = z.object({ x: z.number(), z: z.number() });
const MapSchema = z.object({
  name: z.string(),
  region: z.object({ min: PointSchema, max: PointSchema }),
  teams: z.array(z.object({ color: z.string(), spawns: z.array(PointSchema) })),
  bombs: z.array(
    z.object({ id: z.string(), team: z.string(), at: PointSchema }),
  ),
  nukes: z.array(z.object({ id: z.string(), at: PointSchema })),
});
type MapInfo = z.infer<typeof MapSchema>;

const PX = 10;
const MARGIN = 24;
const PANEL = 220;
/** When the width of each team is first taken: 8 s. */
const SPREAD_TICKS = 160;
/** The second yardstick for crossing the own third: 10 s. */
const BY_TICKS = 200;
/** The opening the headless sim measures dispersion over: 20 s. */
const OPENING_TICKS = 400;
const TEAM_HUES: Record<string, [number, number]> = {
  RED: [335, 395],
  BLUE: [175, 265],
};

async function recordingLines(file: string): Promise<string[]> {
  const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = new TextDecoder().decode(
    gzipped ? Bun.gunzipSync(bytes) : bytes,
  );
  return text.split("\n").filter((line) => line !== "");
}

async function mapInfo(mapId: string): Promise<MapInfo> {
  const file = path.join(ownedConfigDir, "rwf", "maps", mapId, "map.yml");
  return MapSchema.parse(Bun.YAML.parse(await Bun.file(file).text()));
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function teamColor(team: string, index: number, count: number): string {
  const [from, to] = TEAM_HUES[team] ?? [120, 140];
  const hue = from + ((to - from) * index) / Math.max(1, count - 1);
  const light = 38 + (24 * index) / Math.max(1, count - 1);
  return `hsl(${(hue % 360).toFixed(0)}, 78%, ${light.toFixed(0)}%)`;
}

type Frame = { x: (worldX: number) => number; y: (worldZ: number) => number };

function polyline(
  points: { x: number; z: number }[],
  frame: Frame,
  style: string,
): string {
  if (points.length < 2) {
    return "";
  }
  const coords = points
    .map((p) => `${frame.x(p.x).toFixed(1)},${frame.y(p.z).toFixed(1)}`)
    .join(" ");
  return `<polyline points="${coords}" fill="none" ${style}/>`;
}

function mapLayer(map: MapInfo, frame: Frame): string[] {
  const out: string[] = [];
  const { min, max } = map.region;
  out.push(
    `<rect x="${frame.x(min.x).toString()}" y="${frame.y(min.z).toString()}" width="${((max.x - min.x + 1) * PX).toString()}" height="${((max.z - min.z + 1) * PX).toString()}" fill="#f4f1ea" stroke="#8a8578" stroke-width="2"/>`,
  );
  for (const team of map.teams) {
    for (const spawn of team.spawns) {
      out.push(
        `<rect x="${(frame.x(spawn.x) - 3).toFixed(1)}" y="${(frame.y(spawn.z) - 3).toFixed(1)}" width="6" height="6" fill="none" stroke="${teamColor(team.color, 0, 1)}" stroke-width="1"/>`,
      );
    }
  }
  for (const bomb of map.bombs) {
    out.push(
      `<rect x="${frame.x(bomb.at.x).toString()}" y="${frame.y(bomb.at.z).toString()}" width="${PX.toString()}" height="${PX.toString()}" fill="${teamColor(bomb.team, 0, 1)}" stroke="#222" stroke-width="1.5"/>`,
    );
  }
  for (const nuke of map.nukes) {
    out.push(
      `<circle cx="${(frame.x(nuke.at.x) + PX / 2).toString()}" cy="${(frame.y(nuke.at.z) + PX / 2).toString()}" r="${(PX * 0.8).toString()}" fill="#e2b714" stroke="#222" stroke-width="1.5"/>`,
    );
  }
  return out;
}

function trailLayer(trails: Trails, frame: Frame, contact: number): string[] {
  const out: string[] = [];
  const members = new Map<string, string[]>();
  for (const [pseudonym, entry] of trails.roster) {
    const list = members.get(entry.team) ?? [];
    list.push(pseudonym);
    members.set(entry.team, list);
  }
  for (const [team, names] of members) {
    names.sort();
    names.forEach((name, index) => {
      const trail = trails.paths.get(name) ?? [];
      const color = teamColor(team, index, names.length);
      const before = trail.filter((p) => p.tick <= contact);
      const after = trail.filter((p) => p.tick >= contact);
      out.push(
        polyline(
          after,
          frame,
          `stroke="${color}" stroke-opacity="0.18" stroke-width="1"`,
        ),
        polyline(
          before,
          frame,
          `stroke="${color}" stroke-opacity="0.95" stroke-width="2.2" stroke-linejoin="round"`,
        ),
      );
      const last = before.at(-1);
      if (last !== undefined) {
        out.push(
          `<circle cx="${frame.x(last.x).toFixed(1)}" cy="${frame.y(last.z).toFixed(1)}" r="3.2" fill="${color}" stroke="#111" stroke-width="0.8"/>`,
        );
      }
    });
  }
  return out;
}

function statsLines(stats: TeamDispersion[], contactSeconds: string): string[] {
  return [
    `first contact at ${contactSeconds}`,
    ...stats.map(
      (team) =>
        `${team.team}: nearest teammate p50 ${team.nearestP50.toFixed(2)}, mean ${team.nearestMean.toFixed(2)} blocks; most within 2 blocks ${team.maxCrowd.toString()}; ${team.samples.toString()} samples`,
    ),
  ];
}

/** Dashed lines where each team's own third ends: {@link THIRD} blocks out from its spawns. */
function thirdLayer(map: MapInfo, frame: Frame): string[] {
  const { min, max } = map.region;
  return map.teams.map((team) => {
    const spawnX =
      team.spawns.reduce((sum, spawn) => sum + spawn.x, 0) / team.spawns.length;
    const middle = (min.x + max.x + 1) / 2;
    const x = spawnX < middle ? spawnX + THIRD : spawnX - THIRD;
    return `<line x1="${frame.x(x).toFixed(1)}" y1="${frame.y(min.z).toFixed(1)}" x2="${frame.x(x).toFixed(1)}" y2="${frame.y(max.z + 1).toFixed(1)}" stroke="${teamColor(team.color, 0, 1)}" stroke-width="1" stroke-dasharray="6 6" stroke-opacity="0.6"/>`;
  });
}

function percent(share: number | undefined): string {
  return `${((share ?? 0) * 100).toFixed(0)}%`;
}

function advanceLines(
  at8: TeamAdvance[],
  atContact: TeamAdvance[],
  by10: TeamAdvance[],
): string[] {
  return at8.map((team) => {
    const contact = atContact.find((other) => other.team === team.team);
    const later = by10.find((other) => other.team === team.team);
    return `${team.team}: ${team.spreadAt.toFixed(0)} wide at 8 s, ${(contact?.spreadAt ?? 0).toFixed(0)} at contact; past own third ${percent(contact?.forward)} at contact, ${percent(later?.forward)} by 10 s; walked ${(contact?.winding ?? 0).toFixed(2)}x the ground gained`;
  });
}

function render(
  trails: Trails,
  map: MapInfo,
  stats: {
    contact: TeamDispersion[];
    opening: TeamDispersion[];
    at8: TeamAdvance[];
    atContact: TeamAdvance[];
    by10: TeamAdvance[];
  },
  contact: number,
): string {
  const { min, max } = map.region;
  const width = (max.x - min.x + 1) * PX + 2 * MARGIN;
  const mapHeight = (max.z - min.z + 1) * PX + 2 * MARGIN + 28;
  const height = mapHeight + PANEL;
  const frame: Frame = {
    x: (worldX) => MARGIN + (worldX - min.x) * PX,
    y: (worldZ) => MARGIN + 28 + (worldZ - min.z) * PX,
  };
  const contactSeconds =
    trails.firstContact === undefined
      ? "never"
      : `${(trails.firstContact / 20).toFixed(1)} s`;
  const title = `${args.label} · ${map.name} · ${trails.roster.size.toString()} combatants`;
  const lines = [
    ...statsLines(stats.contact, contactSeconds),
    ...advanceLines(stats.at8, stats.atContact, stats.by10),
    ...stats.opening.map(
      (team) =>
        `${team.team} over the first 20 s: p50 ${team.nearestP50.toFixed(2)}, mean ${team.nearestMean.toFixed(2)} blocks; most within 2 blocks ${team.maxCrowd.toString()}`,
    ),
  ];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toString()}" height="${height.toString()}" viewBox="0 0 ${width.toString()} ${height.toString()}">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<text x="${MARGIN.toString()}" y="${(MARGIN + 6).toString()}" font-family="sans-serif" font-size="18" font-weight="bold" fill="#111">${escapeXml(title)}</text>`,
    ...mapLayer(map, frame),
    ...thirdLayer(map, frame),
    ...trailLayer(trails, frame, contact),
    ...lines.map(
      (line, index) =>
        `<text x="${MARGIN.toString()}" y="${(mapHeight + 10 + index * 22).toString()}" font-family="sans-serif" font-size="14" fill="#222">${escapeXml(line)}</text>`,
    ),
    `<text x="${MARGIN.toString()}" y="${(height - 12).toString()}" font-family="sans-serif" font-size="11" fill="#666">Solid: to first contact; faint: after. Dots: at first contact. Dashed: end of each team's own third.</text>`,
    `</svg>`,
  ].join("\n");
}

const trails = readTrails(await recordingLines(args.recording));
const map = await mapInfo(trails.mapId);
const contact = trails.firstContact ?? trails.lastTick + 1;
const stats = dispersion(trails, { from: 0, until: contact });
const opening = dispersion(trails, { from: 0, until: OPENING_TICKS });
const at8 = advance(trails, { at: SPREAD_TICKS, until: contact });
const atContact = advance(trails, { at: contact, until: contact });
const by10 = advance(trails, { at: BY_TICKS, until: BY_TICKS });
const svg = render(
  trails,
  map,
  { contact: stats, opening, at8, atContact, by10 },
  contact,
);
const png = new Resvg(svg, { font: { loadSystemFonts: true } }).render();
await Bun.write(args.out, png.asPng());
await Bun.write(
  Bun.stdout,
  JSON.stringify(
    {
      recording: args.recording,
      out: args.out,
      firstContactTick: trails.firstContact ?? null,
      lastTick: trails.lastTick,
      beforeContact: stats,
      firstTwentySeconds: opening,
      advanceAt8s: at8,
      advanceAtContact: atContact,
      advanceBy10s: by10,
    },
    undefined,
    2,
  ) + "\n",
);
