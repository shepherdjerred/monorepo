import {
  DOOM_BOTS_QUEUES,
  parseQueueType,
  QueueTypeSchema,
  type QueueType,
} from "#src/model/state.ts";
import {
  QueueWindowsFileSchema,
  type QueueWindow,
  type QueueWindowsFile,
} from "#src/model/queue-windows.schema.ts";

/**
 * Pure drift engine for the queue-windows watcher. Given the current
 * `queue-windows.json` contents and observed per-day match counts, it proposes
 * open/reopen/close edits to the limited-queue availability windows.
 *
 * No I/O and no `Date.now()` — `today` is an explicit input so the function is
 * fully deterministic and unit-testable.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Distinct-days + total-match thresholds that trigger opening a window. */
const OPEN_MIN_DISTINCT_DAYS = 2;
const OPEN_MIN_TOTAL_MATCHES = 3;
/** A recent close within this many days of new activity reopens the window. */
const REOPEN_MAX_GAP_DAYS = 7;
/** Trailing run of days that must be empty before a close is considered. */
const CLOSE_TRAILING_EMPTY_DAYS = 10;
/** Earlier-in-window match volume required to trust an auto-close. */
const CLOSE_MIN_VOLUME_BASELINE = 20;
/**
 * A window must be at least this old before an auto-close is trusted.
 *
 * The volume baseline proves a mode WAS live; it says nothing about whether it
 * stopped being live. A launch-week burst followed by quiet satisfies it
 * perfectly, and that is the exact shape of a false positive: our evidence is
 * biased to Scout's tracked players, so "nobody played it for 10 days" and
 * "Riot turned it off" are indistinguishable.
 *
 * This fired for real. `classic aram mayhem` opened 2026-07-29 — the start of
 * Ranked Season 3 — took 20+ matches over its first two days, then went quiet;
 * on 2026-08-10 the watcher proposed retiring it (PR #2100) while ARAM: Mayhem
 * was still receiving balance changes in the current patch. Twelve days is not
 * enough evidence to retire a mode.
 *
 * This value is coupled to the caller's `lookbackDays` — see
 * `MIN_DRIFT_LOOKBACK_DAYS`.
 */
const CLOSE_MIN_WINDOW_AGE_DAYS = 21;
/**
 * Daily runs on which an otherwise-valid close must stay proposable.
 *
 * A close is not applied automatically: it opens a PR for a human to confirm
 * against patch notes, and the watcher closes that PR as soon as a later run
 * produces no drift. So the close must survive re-derivation across enough
 * consecutive runs for someone to actually review it — a week.
 */
const CLOSE_MIN_ELIGIBLE_RUNS = 7;
/**
 * Smallest observation lookback that gives closes a usable review window.
 *
 * The two gates pull against each other. `CLOSE_MIN_WINDOW_AGE_DAYS` sets the
 * earliest age at which a close may be proposed; `lookbackDays` sets the latest,
 * because the volume baseline is only counted from observations still inside the
 * lookback. In the worst case — every baseline match on the window's first day,
 * which is exactly the launch-burst shape the age gate exists for — the close is
 * proposable only while `CLOSE_MIN_WINDOW_AGE_DAYS <= age <= lookbackDays`.
 *
 * A lookback equal to the minimum age therefore collapses that band to a single
 * run: the day after, the burst falls out of the lookback, the baseline drops
 * below threshold, the run reports no drift, and the watcher closes the
 * unreviewed proposal PR permanently.
 */
export const MIN_DRIFT_LOOKBACK_DAYS =
  CLOSE_MIN_WINDOW_AGE_DAYS + CLOSE_MIN_ELIGIBLE_RUNS - 1;

export type QueueWindowEditKind = "open" | "reopen" | "close";

export type QueueWindowEdit = {
  queue: QueueType;
  kind: QueueWindowEditKind;
  /** Start date for open/reopen; end date for close (`YYYY-MM-DD`). */
  date: string;
  message: string;
};

export type QueueWindowWarningKind =
  | "sparse-no-close"
  | "no-volume-baseline"
  | "window-too-young"
  | "unknown-queue-id";

export type QueueWindowWarning = {
  kind: QueueWindowWarningKind;
  queue?: QueueType;
  queueId?: string;
  total: number;
  message: string;
};

export type ProposeQueueWindowEditsInput = {
  file: QueueWindowsFile;
  /** raw queueId string → `YYYY-MM-DD` → match count. */
  counts: Record<string, Record<string, number>>;
  /** `YYYY-MM-DD` UTC. */
  today: string;
  /** How many days back the observation window spans. */
  lookbackDays: number;
};

export type ProposeQueueWindowEditsResult = {
  next: QueueWindowsFile;
  edits: QueueWindowEdit[];
  warnings: QueueWindowWarning[];
};

function parseUtcDate(dateString: string): number {
  return Date.parse(`${dateString}T00:00:00.000Z`);
}

function windowCoversDate(window: QueueWindow, date: string): boolean {
  if (date < window.start) {
    return false;
  }
  return window.end === null || date <= window.end;
}

function appendNote(existing: string | undefined, addition: string): string {
  return existing === undefined || existing.length === 0
    ? addition
    : `${existing}; ${addition}`;
}

/** Structural equality of two window histories (field-by-field, in order). */
function windowsEqual(a: QueueWindow[], b: QueueWindow[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((window, index) => {
    const other = b[index];
    if (other === undefined) {
      return false;
    }
    return (
      window.start === other.start &&
      window.end === other.end &&
      window.source === other.source &&
      window.note === other.note
    );
  });
}

/** A processing unit: one limited queue, or the Doom Bots trio in lockstep. */
type QueueUnit = {
  keys: QueueType[];
  /** Windows shared by every key (identical for lockstep groups). */
  windows: QueueWindow[];
};

function buildUnits(file: QueueWindowsFile): QueueUnit[] {
  const limitedQueues = Object.keys(file.queues).map((key) =>
    QueueTypeSchema.parse(key),
  );
  const limitedSet = new Set<QueueType>(limitedQueues);

  const units: QueueUnit[] = [];
  const doomBotsKeys = DOOM_BOTS_QUEUES.filter((queue) =>
    limitedSet.has(queue),
  );
  const doomBotsSet = new Set<QueueType>(doomBotsKeys);

  const singles = limitedQueues
    .filter((queue) => !doomBotsSet.has(queue))
    .sort((a, b) => a.localeCompare(b));

  for (const queue of singles) {
    const windows = file.queues[queue];
    if (windows === undefined) {
      throw new Error(`queue-windows file is missing windows for "${queue}"`);
    }
    units.push({ keys: [queue], windows });
  }

  if (doomBotsKeys.length > 0) {
    const firstKey = doomBotsKeys[0];
    if (firstKey === undefined) {
      throw new Error("unreachable: doomBotsKeys is non-empty");
    }
    const windows = file.queues[firstKey];
    if (windows === undefined) {
      throw new Error(
        `queue-windows file is missing windows for "${firstKey}"`,
      );
    }
    // Doom Bots difficulties move in lockstep — every difficulty must carry an
    // identical window history. A divergent manual edit is a broken invariant,
    // not something to silently paper over by adopting the first difficulty's
    // windows (which the next open/reopen/close would then overwrite across all
    // three, destroying the divergent data). Fail loudly instead.
    for (const key of doomBotsKeys) {
      const keyWindows = file.queues[key];
      if (keyWindows === undefined) {
        throw new Error(`queue-windows file is missing windows for "${key}"`);
      }
      if (!windowsEqual(keyWindows, windows)) {
        throw new Error(
          `Doom Bots difficulties are out of lockstep: "${key}" window history ` +
            `differs from "${firstKey}". All Doom Bots queues must share an ` +
            `identical history; reconcile the divergent manual edit before the ` +
            `watcher runs.`,
        );
      }
    }
    units.push({ keys: [...doomBotsKeys], windows });
  }

  return units;
}

type Observations = {
  perQueue: Map<QueueType, Map<string, number>>;
  unknownTotals: Map<string, number>;
};

function aggregateObservations(
  counts: Record<string, Record<string, number>>,
  obsStartMs: number,
  obsEndMs: number,
): Observations {
  const perQueue = new Map<QueueType, Map<string, number>>();
  const unknownTotals = new Map<string, number>();

  for (const [queueId, byDate] of Object.entries(counts)) {
    const queueType = parseQueueType(Number(queueId));
    for (const [date, count] of Object.entries(byDate)) {
      if (count <= 0) {
        continue;
      }
      const dateMs = parseUtcDate(date);
      if (Number.isNaN(dateMs) || dateMs < obsStartMs || dateMs > obsEndMs) {
        continue;
      }
      if (queueType === undefined) {
        unknownTotals.set(queueId, (unknownTotals.get(queueId) ?? 0) + count);
        continue;
      }
      const byDateForQueue =
        perQueue.get(queueType) ?? new Map<string, number>();
      byDateForQueue.set(date, (byDateForQueue.get(date) ?? 0) + count);
      perQueue.set(queueType, byDateForQueue);
    }
  }

  return { perQueue, unknownTotals };
}

function mergeUnitObservations(
  unit: QueueUnit,
  perQueue: Map<QueueType, Map<string, number>>,
): Map<string, number> {
  const merged = new Map<string, number>();
  for (const key of unit.keys) {
    const byDate = perQueue.get(key);
    if (byDate === undefined) {
      continue;
    }
    for (const [date, count] of byDate) {
      merged.set(date, (merged.get(date) ?? 0) + count);
    }
  }
  return merged;
}

type UnitChange = {
  windows: QueueWindow[];
  kind: QueueWindowEditKind;
  date: string;
  describe: (queue: QueueType) => string;
};

type OpenInput = {
  windows: QueueWindow[];
  unitObs: Map<string, number>;
  today: string;
};

function tryOpenOrReopen(input: OpenInput): UnitChange | undefined {
  const { windows, unitObs, today } = input;
  if (windows.some((window) => windowCoversDate(window, today))) {
    return undefined;
  }

  const lastWindow = windows.at(-1);
  const priorEnd = lastWindow?.end;

  // Only observations strictly after the last window's (inclusive) end count as
  // NEW activity. Matches on or before `priorEnd` are already covered by that
  // closed window; counting them would make a just-closed window's own stale
  // volume satisfy the open thresholds and reopen it on the next daily run
  // (the reopen gap would even be negative — always within the limit).
  const newObs = [...unitObs.entries()].filter(([date]) =>
    priorEnd == null ? true : date > priorEnd,
  );
  const observedDates = newObs
    .map(([date]) => date)
    .sort((a, b) => a.localeCompare(b));
  const firstSeen = observedDates[0];
  let totalMatches = 0;
  for (const [, count] of newObs) {
    totalMatches += count;
  }
  const distinctDays = observedDates.length;

  if (
    firstSeen === undefined ||
    distinctDays < OPEN_MIN_DISTINCT_DAYS ||
    totalMatches < OPEN_MIN_TOTAL_MATCHES
  ) {
    return undefined;
  }

  const gapWithinReopen =
    priorEnd != null &&
    parseUtcDate(firstSeen) - parseUtcDate(priorEnd) <=
      REOPEN_MAX_GAP_DAYS * DAY_MS;

  if (lastWindow !== undefined && gapWithinReopen) {
    const lastStart = lastWindow.start;
    const nextWindows = windows.map((window, index) =>
      index === windows.length - 1
        ? {
            ...window,
            end: null,
            note: appendNote(window.note, `reopened by watcher ${today}`),
          }
        : window,
    );
    return {
      windows: nextWindows,
      kind: "reopen",
      date: lastStart,
      describe: (queue) =>
        `${queue}: reopened window starting ${lastStart} (was closed ${priorEnd}); observed ${totalMatches.toString()} matches over ${distinctDays.toString()} days since ${firstSeen}`,
    };
  }

  const nextWindows: QueueWindow[] = [
    ...windows,
    { start: firstSeen, end: null, source: "observed" },
  ];
  return {
    windows: nextWindows,
    kind: "open",
    date: firstSeen,
    describe: (queue) =>
      `${queue}: opened new window starting ${firstSeen}; observed ${totalMatches.toString()} matches over ${distinctDays.toString()} days`,
  };
}

type CloseOutcome =
  | { type: "close"; change: UnitChange }
  | {
      type: "warning";
      kind: "sparse-no-close" | "no-volume-baseline" | "window-too-young";
      total: number;
      /** Why the close was withheld, spliced into the operator-facing text. */
      reason: string;
    };

function tryClose(
  windows: QueueWindow[],
  unitObs: Map<string, number>,
  todayMs: number,
): CloseOutcome | undefined {
  const lastWindow = windows.at(-1);
  if (lastWindow?.end !== null) {
    return undefined;
  }

  // Only matches within the current open window (on/after its start) are
  // evidence about whether THIS window is still live. Earlier matches belong to
  // prior windows; counting them would let a preceding run's volume satisfy the
  // 20-match close baseline and close the new window on a single stray day.
  const windowStart = lastWindow.start;
  const windowObs = [...unitObs.entries()].filter(
    ([date]) => date >= windowStart,
  );

  const trailingStartMs = todayMs - CLOSE_TRAILING_EMPTY_DAYS * DAY_MS;
  let trailingTotal = 0;
  let earlierTotal = 0;
  for (const [date, count] of windowObs) {
    if (parseUtcDate(date) >= trailingStartMs) {
      trailingTotal += count;
    } else {
      earlierTotal += count;
    }
  }

  if (trailingTotal !== 0) {
    return undefined;
  }

  const lastSeen = windowObs
    .map(([date]) => date)
    .sort((a, b) => a.localeCompare(b))
    .at(-1);

  const closeEnd =
    lastSeen !== undefined && earlierTotal >= CLOSE_MIN_VOLUME_BASELINE
      ? lastSeen
      : undefined;

  if (closeEnd !== undefined) {
    // Final veto on an otherwise-valid close. Deliberately last: it must mean
    // "every other signal said close, but the window is too new to trust", not
    // pre-empt the volume-baseline check — otherwise a young window with
    // trivial volume would be reported as too-young rather than as having no
    // baseline, and the more specific diagnosis would be lost.
    const windowAgeDays = Math.floor(
      (todayMs - parseUtcDate(windowStart)) / DAY_MS,
    );
    if (windowAgeDays < CLOSE_MIN_WINDOW_AGE_DAYS) {
      return {
        type: "warning",
        kind: "window-too-young",
        total: earlierTotal,
        reason: `the window is only ${windowAgeDays.toString()} day(s) old (minimum ${CLOSE_MIN_WINDOW_AGE_DAYS.toString()} before an auto-close is trusted)`,
      };
    }

    const nextWindows = windows.map((window, index) =>
      index === windows.length - 1 ? { ...window, end: closeEnd } : window,
    );
    return {
      type: "close",
      change: {
        windows: nextWindows,
        kind: "close",
        date: closeEnd,
        describe: (queue) =>
          `${queue}: closed open-ended window (start ${lastWindow.start}) at ${closeEnd}; no matches in the last ${CLOSE_TRAILING_EMPTY_DAYS.toString()} days after ${earlierTotal.toString()} earlier matches`,
      },
    };
  }

  if (earlierTotal > 0) {
    return {
      type: "warning",
      kind: "no-volume-baseline",
      total: earlierTotal,
      reason: `volume baseline is below threshold (${earlierTotal.toString()} < ${CLOSE_MIN_VOLUME_BASELINE.toString()})`,
    };
  }
  return {
    type: "warning",
    kind: "sparse-no-close",
    total: 0,
    reason: "the mode is sparse (no matches observed in the window at all)",
  };
}

export function proposeQueueWindowEdits(
  input: ProposeQueueWindowEditsInput,
): ProposeQueueWindowEditsResult {
  const { file, counts, today, lookbackDays } = input;
  const todayMs = parseUtcDate(today);
  if (Number.isNaN(todayMs)) {
    throw new TypeError(`invalid today date: ${today}`);
  }
  if (lookbackDays < MIN_DRIFT_LOOKBACK_DAYS) {
    throw new RangeError(
      `lookbackDays must be at least ${MIN_DRIFT_LOOKBACK_DAYS.toString()} (got ${lookbackDays.toString()}): a close is only proposable while the window is between ${CLOSE_MIN_WINDOW_AGE_DAYS.toString()} and lookbackDays days old, and that band must span at least ${CLOSE_MIN_ELIGIBLE_RUNS.toString()} daily runs for the proposal PR to be reviewable`,
    );
  }
  const obsStartMs = todayMs - lookbackDays * DAY_MS;
  const obsEndMs = todayMs - DAY_MS;

  const { perQueue, unknownTotals } = aggregateObservations(
    counts,
    obsStartMs,
    obsEndMs,
  );

  const edits: QueueWindowEdit[] = [];
  const warnings: QueueWindowWarning[] = [];

  for (const [queueId, total] of [...unknownTotals.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    warnings.push({
      kind: "unknown-queue-id",
      queueId,
      total,
      message: `unmapped queue id ${queueId} had ${total.toString()} match(es) in the observation window`,
    });
  }

  const nextQueues: Record<string, QueueWindow[]> = Object.fromEntries(
    Object.entries(file.queues),
  );

  const units = buildUnits(file);
  for (const unit of units) {
    const primaryKey = unit.keys[0];
    if (primaryKey === undefined) {
      throw new Error("unreachable: queue unit has no keys");
    }

    // A future-announced window (last window starts after today, e.g. a mode
    // manually recorded ahead of its start with end:null) is not yet active.
    // Skip drift evaluation entirely: treating it as open would emit a
    // misleading sparse-no-close warning every day, and an "open" append with
    // enough pre-start observations would insert an out-of-order window that
    // fails schema validation. Nothing to do until its start date arrives.
    const lastWindow = unit.windows.at(-1);
    if (lastWindow !== undefined && lastWindow.start > today) {
      continue;
    }

    const unitObs = mergeUnitObservations(unit, perQueue);

    const openChange = tryOpenOrReopen({
      windows: unit.windows,
      unitObs,
      today,
    });

    let change: UnitChange | undefined = openChange;
    if (change === undefined) {
      const closeOutcome = tryClose(unit.windows, unitObs, todayMs);
      if (closeOutcome !== undefined) {
        if (closeOutcome.type === "close") {
          change = closeOutcome.change;
        } else {
          warnings.push({
            kind: closeOutcome.kind,
            queue: primaryKey,
            total: closeOutcome.total,
            message: `${unit.keys.join("/")}: open-ended window has no recent matches but ${closeOutcome.reason}; not auto-closing`,
          });
        }
      }
    }

    if (change !== undefined) {
      for (const key of unit.keys) {
        nextQueues[key] = change.windows;
        edits.push({
          queue: key,
          kind: change.kind,
          date: change.date,
          message: change.describe(key),
        });
      }
    }
  }

  const next = QueueWindowsFileSchema.parse({ queues: nextQueues });
  return { next, edits, warnings };
}
