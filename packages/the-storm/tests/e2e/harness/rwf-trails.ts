/**
 * Top-down trajectories and team dispersion read from a Search and Destroy
 * match recording: the tab-separated rows of rwf's `RecordCodec` (`R` roster,
 * `F` frames, `I` intents, `E` events, `X` end). Shared by the full-lane
 * rwfbots suite, which asserts the dispersion, and `scripts/rwf-trails.ts`,
 * which draws it.
 */

/** Frame positions are stored as fixed point, this many steps per block. */
export const POSITION_SCALE = 32;

/**
 * Teammates closer than this crowd one spot. Strictly closer: rwf's spawn
 * points stand exactly two blocks apart.
 */
export const CROWD_RADIUS = 2;

export type TrailPoint = { tick: number; x: number; z: number };

export type Trails = {
  mapId: string;
  roster: Map<string, { team: string; bot: boolean }>;
  /** Each combatant's living positions, oldest first. */
  paths: Map<string, TrailPoint[]>;
  /** The first tick a sword blow landed or anyone died, if ever. */
  firstContact: number | undefined;
  /** The last tick of the recording. */
  lastTick: number;
};

/**
 * Intents and events that mean two teams have met: a sword blow that went
 * through the rules (`attack` is only written for landed swings) or a death.
 * A loosed arrow (`shoot`) is not contact: archers open fire from 30 blocks
 * and most arrows miss; the recording has no row for an arrow that hits
 * without killing.
 */
const CONTACT_INTENTS = new Set(["attack"]);
const CONTACT_EVENTS = new Set(["died", "killed"]);

function int(text: string | undefined, what: string): number {
  const value = Number(text);
  if (text === undefined || text === "" || !Number.isInteger(value)) {
    throw new Error(`bad ${what}: ${String(text)}`);
  }
  return value;
}

function earliest(current: number | undefined, tick: number): number {
  return current === undefined ? tick : Math.min(current, tick);
}

/**
 * Adds one frame row to {@code trails}. Two server ticks can fall into one
 * recording tick when the server catches up after a slow tick; the later
 * frame stands for the tick.
 */
function addFrame(trails: Trails, fields: string[]): void {
  const tick = int(fields[1], "frame tick");
  const pseudonym = fields[2] ?? "";
  const path = trails.paths.get(pseudonym) ?? [];
  const point = {
    tick,
    x: int(fields[3], "frame x") / POSITION_SCALE,
    z: int(fields[5], "frame z") / POSITION_SCALE,
  };
  if (path.at(-1)?.tick === tick) {
    path[path.length - 1] = point;
  } else {
    path.push(point);
  }
  trails.paths.set(pseudonym, path);
  trails.lastTick = Math.max(trails.lastTick, tick);
}

/** The tick a contact row happened at, or undefined for any other intent or event. */
function contactTick(fields: string[]): number | undefined {
  const contact =
    fields[0] === "I"
      ? CONTACT_INTENTS.has(fields[3] ?? "")
      : CONTACT_EVENTS.has(fields[2] ?? "");
  return contact ? int(fields[1], "contact tick") : undefined;
}

/** Reads a recording's rows; an unknown or malformed row is an error. */
export function readTrails(lines: string[]): Trails {
  const trails: Trails = {
    mapId: "",
    roster: new Map(),
    paths: new Map(),
    firstContact: undefined,
    lastTick: 0,
  };
  for (const line of lines) {
    const fields = line.split("\t");
    switch (fields[0]) {
      case "H": {
        trails.mapId = fields[3] ?? "";
        break;
      }
      case "R": {
        trails.roster.set(fields[1] ?? "", {
          team: fields[2] ?? "",
          bot: fields[4] === "true",
        });
        break;
      }
      case "F": {
        addFrame(trails, fields);
        break;
      }
      case "I":
      case "E": {
        const tick = contactTick(fields);
        if (tick !== undefined) {
          trails.firstContact = earliest(trails.firstContact, tick);
        }
        break;
      }
      case "X":
      case "P": {
        break;
      }
      case undefined:
      default: {
        throw new Error(`unknown recording row: ${line.slice(0, 40)}`);
      }
    }
  }
  if (trails.mapId === "") {
    throw new Error("the recording has no header row");
  }
  for (const path of trails.paths.values()) {
    path.sort((a, b) => a.tick - b.tick);
  }
  return trails;
}

export type TeamDispersion = {
  team: string;
  /** Member-ticks measured. */
  samples: number;
  /** Median distance from a member to its nearest teammate, in blocks. */
  nearestP50: number;
  nearestMean: number;
  /** The most teammates ever closer than {@link CROWD_RADIUS} to one of them. */
  maxCrowd: number;
};

/** The {@code q} quantile of sorted {@code values}, or NaN when empty. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(q * sorted.length) - 1),
  );
  return sorted[index] ?? Number.NaN;
}

/** Each tick's living positions, by team, inside {@code window}. */
function positionsByTick(
  trails: Trails,
  window: { from: number; until: number },
): Map<number, Map<string, TrailPoint[]>> {
  const byTick = new Map<number, Map<string, TrailPoint[]>>();
  for (const [pseudonym, path] of trails.paths) {
    const team = trails.roster.get(pseudonym)?.team;
    if (team === undefined) {
      throw new Error(`${pseudonym} has frames but no roster row`);
    }
    for (const point of path.filter(
      (p) => p.tick >= window.from && p.tick < window.until,
    )) {
      const teams = byTick.get(point.tick) ?? new Map<string, TrailPoint[]>();
      teams.set(team, [...(teams.get(team) ?? []), point]);
      byTick.set(point.tick, teams);
    }
  }
  return byTick;
}

/** A member's nearest teammate distance and how many teammates crowd it. */
function around(
  member: TrailPoint,
  members: TrailPoint[],
): { nearest: number; crowd: number } {
  let nearest = Number.POSITIVE_INFINITY;
  let crowd = 1;
  for (const other of members) {
    if (other === member) {
      continue;
    }
    const d = Math.hypot(other.x - member.x, other.z - member.z);
    nearest = Math.min(nearest, d);
    crowd += d < CROWD_RADIUS ? 1 : 0;
  }
  return { nearest, crowd };
}

/**
 * How spread out each team was over ticks {@code from} (inclusive) to
 * {@code until} (exclusive): every living member's horizontal distance to its
 * nearest living teammate, sampled each tick both had a frame.
 */
export function dispersion(
  trails: Trails,
  window: { from: number; until: number },
): TeamDispersion[] {
  const nearest = new Map<string, number[]>();
  const crowd = new Map<string, number>();
  for (const teams of positionsByTick(trails, window).values()) {
    for (const [team, members] of teams) {
      if (members.length < 2) {
        continue;
      }
      const distances = nearest.get(team) ?? [];
      for (const member of members) {
        const here = around(member, members);
        distances.push(here.nearest);
        crowd.set(team, Math.max(crowd.get(team) ?? 0, here.crowd));
      }
      nearest.set(team, distances);
    }
  }
  return [...nearest.entries()]
    .map(([team, distances]) => {
      const sorted = distances.toSorted((a, b) => a - b);
      const sum = sorted.reduce((total, d) => total + d, 0);
      return {
        team,
        samples: sorted.length,
        nearestP50: quantile(sorted, 0.5),
        nearestMean: sum / sorted.length,
        maxCrowd: crowd.get(team) ?? 0,
      };
    })
    .toSorted((a, b) => a.team.localeCompare(b.team));
}
