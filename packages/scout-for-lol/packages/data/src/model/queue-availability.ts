import queueWindowsJson from "#src/model/queue-windows.json" with { type: "json" };
import { QueueTypeSchema, type QueueType } from "#src/model/state.ts";
import { QueueWindowsFileSchema } from "#src/model/queue-windows.schema.ts";
import type { CompetitionQueueType } from "#src/model/competition.ts";

/**
 * Availability windows for limited-time queues.
 *
 * The window data is a hand-maintained, append-only record stored in the
 * language-neutral source of truth `queue-windows.json` (validated by
 * `queue-windows.schema.ts`): when Riot announces a mode run, append a window;
 * when a mode goes permanent, move it to the permanent list below. An open-ended
 * current run uses `end: null` — close it when Riot turns the mode off.
 *
 * The JSON is edited both by hand and by the queue-windows watcher
 * (`packages/temporal` + backend `update-queue-windows`), which proposes
 * observed windows from real match volume. Only the current-window check drives
 * UI behavior; older windows exist for context.
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

const rawQueueWindows: unknown = queueWindowsJson;
const queueWindowsFile = QueueWindowsFileSchema.parse(rawQueueWindows);

/**
 * Convert the JSON windows for a limited queue into the runtime shape. Throws
 * (fail fast) when the queue has no entry in `queue-windows.json`.
 */
function limitedFromJson(queue: QueueType): QueueAvailability {
  const windows = queueWindowsFile.queues[queue];
  if (windows === undefined) {
    throw new Error(
      `queue-windows.json is missing window data for limited queue "${queue}"`,
    );
  }
  return {
    kind: "limited",
    windows: windows.map((window) => ({
      start: new Date(window.start),
      // End dates are inclusive through the entire (UTC) end day — a bare
      // date would parse to midnight and exclude almost all of the last day.
      end: window.end === null ? null : new Date(`${window.end}T23:59:59.999Z`),
    })),
  };
}

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
  arurf: limitedFromJson("arurf"),
  urf: limitedFromJson("urf"),
  quickplay: PERMANENT,
  swiftplay: PERMANENT,
  arena: limitedFromJson("arena"),
  classic: limitedFromJson("classic"),
  brawl: limitedFromJson("brawl"),
  "aram mayhem": limitedFromJson("aram mayhem"),
  "draft pick": PERMANENT,
  "easy doom bots": limitedFromJson("easy doom bots"),
  "normal doom bots": limitedFromJson("normal doom bots"),
  "hard doom bots": limitedFromJson("hard doom bots"),
  custom: PERMANENT,
};

// Fail fast if the JSON carries a key that is not a known QueueType, or window
// data for a queue we treat as permanent — either is a data/model mismatch.
for (const key of Object.keys(queueWindowsFile.queues)) {
  const parsedKey = QueueTypeSchema.safeParse(key);
  if (!parsedKey.success) {
    throw new Error(
      `queue-windows.json has key "${key}" that is not a known QueueType`,
    );
  }
  if (QUEUE_AVAILABILITY[parsedKey.data].kind !== "limited") {
    throw new Error(
      `queue-windows.json has window data for "${key}", which is not a limited queue`,
    );
  }
}

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
