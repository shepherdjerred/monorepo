import type { QueueType } from "#src/model/state.ts";
import type { CompetitionQueueType } from "#src/model/competition.ts";

/**
 * Availability windows for limited-time queues.
 *
 * Like SEASONS (src/seasons.ts) this is a hand-maintained, append-only record:
 * when Riot announces a mode run, append a window; when a mode goes permanent,
 * switch it to `{ kind: "permanent" }`. An open-ended current run uses
 * `end: null` — close it when Riot turns the mode off.
 *
 * Sources: wiki.leagueoflegends.com per-mode availability history + Riot patch
 * notes (researched 2026-07-26). Pre-2024 windows are approximate on the end
 * date (runs typically last until the next patch); they exist for context —
 * only the current-window check drives UI behavior.
 */

export type QueueAvailabilityWindow = {
  start: Date;
  /** null = open-ended: the mode is live with no announced end. */
  end: Date | null;
};

export type QueueAvailability =
  | { kind: "permanent" }
  | { kind: "limited"; windows: QueueAvailabilityWindow[] };

const PERMANENT: QueueAvailability = { kind: "permanent" };

function limited(
  windows: [start: string, end: string | null][],
): QueueAvailability {
  return {
    kind: "limited",
    windows: windows.map(([start, end]) => ({
      start: new Date(start),
      end: end === null ? null : new Date(end),
    })),
  };
}

// The 2025 Doom Bots revival ("Trials of Twilight" Act I, V25.17-V25.20).
// The 2016-17 rotating-game-mode weekends used different queue IDs that
// predate this app's queue model, so they are not represented here.
const DOOM_BOTS_2025: QueueAvailability = limited([
  ["2025-08-27", "2025-10-22"],
]);

export const QUEUE_AVAILABILITY: Record<QueueType, QueueAvailability> = {
  solo: PERMANENT,
  flex: PERMANENT,
  "ranked 5s": PERMANENT,
  // Clash (and ARAM clash) run on scheduled event weekends roughly monthly;
  // the queues themselves are a standing part of the rotation, so they are
  // treated as permanent rather than hidden between event weekends.
  clash: PERMANENT,
  "aram clash": PERMANENT,
  aram: PERMANENT,
  arurf: limited([
    // Ends approximate (~the following patch) for pre-2025 runs.
    ["2021-02-03", "2021-03-03"],
    ["2022-01-26", "2022-02-23"],
    ["2023-01-11", "2023-02-08"],
    ["2025-01-23", "2025-02-20"],
    ["2025-07-30", "2025-08-27"],
    ["2026-01-22", "2026-02-18"],
  ]),
  urf: limited([
    ["2014-04-03", "2014-04-13"],
    ["2019-10-28", "2019-11-08"],
    ["2025-11-19", "2025-12-10"],
  ]),
  quickplay: PERMANENT,
  swiftplay: PERMANENT,
  arena: limited([
    ["2023-07-20", "2023-08-28"],
    ["2023-12-07", "2024-01-08"],
    ["2024-05-01", "2024-09-24"],
    ["2025-03-01", "2025-05-14"],
    // Current run (patch 25.13): committed for at least 12 months and still
    // live as of July 2026 with no announced end.
    ["2025-06-25", null],
  ]),
  brawl: limited([
    ["2025-05-14", "2025-11-19"],
    ["2026-03-04", "2026-04-28"],
  ]),
  // Launched with Trials of Twilight Act II and extended indefinitely after
  // positive reception; still live as of July 2026.
  "aram mayhem": limited([["2025-10-22", null]]),
  "draft pick": PERMANENT,
  "easy doom bots": DOOM_BOTS_2025,
  "normal doom bots": DOOM_BOTS_2025,
  "hard doom bots": DOOM_BOTS_2025,
  custom: PERMANENT,
};

function isWithinWindow(window: QueueAvailabilityWindow, now: Date): boolean {
  if (now < window.start) {
    return false;
  }
  return window.end === null || now <= window.end;
}

export function isQueueCurrentlyAvailable(
  queue: QueueType,
  now: Date = new Date(),
): boolean {
  const availability = QUEUE_AVAILABILITY[queue];
  if (availability.kind === "permanent") {
    return true;
  }
  return availability.windows.some((window) => isWithinWindow(window, now));
}

/**
 * Short human-readable note for pickers. Returns undefined for permanent
 * queues and for limited queues that are currently live.
 */
export function queueAvailabilityNote(
  queue: QueueType,
  now: Date = new Date(),
): string | undefined {
  const availability = QUEUE_AVAILABILITY[queue];
  if (
    availability.kind === "permanent" ||
    isQueueCurrentlyAvailable(queue, now)
  ) {
    return undefined;
  }
  return "Limited-time mode — not currently live";
}

/**
 * Competition queue choices map onto one or more match queues. An empty list
 * means the choice is not tied to a limited-time mode (it always stays
 * selectable).
 */
export const COMPETITION_QUEUE_TO_QUEUE_TYPES: Record<
  CompetitionQueueType,
  QueueType[]
> = {
  SOLO: ["solo"],
  FLEX: ["flex"],
  RANKED_ANY: [],
  ARENA: ["arena"],
  ARAM: ["aram"],
  URF: ["urf"],
  ARURF: ["arurf"],
  QUICKPLAY: ["quickplay"],
  SWIFTPLAY: ["swiftplay"],
  BRAWL: ["brawl"],
  DRAFT_PICK: ["draft pick"],
  CUSTOM: [],
  ALL: [],
};

export function isCompetitionQueueCurrentlyAvailable(
  queue: CompetitionQueueType,
  now: Date = new Date(),
): boolean {
  const queues = COMPETITION_QUEUE_TO_QUEUE_TYPES[queue];
  if (queues.length === 0) {
    return true;
  }
  return queues.some((entry) => isQueueCurrentlyAvailable(entry, now));
}
