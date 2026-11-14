import type { CueName } from "./cues.ts";

/** An outcome of something this person just did, worth a sound or a buzz. */
export type FeedbackEvent =
  | "create"
  | "complete"
  | "status"
  | "edit"
  | "due"
  | "pickup"
  | "drop"
  | "comment"
  | "undo"
  | "error"
  | "destructive"
  | "palette"
  | "select"
  | "longPress";

export type HapticName = "tap" | "medium" | "success" | "warning" | "longPress";

/** `navigator.vibrate` patterns, in milliseconds of vibration and pause. */
export const hapticPatterns: Record<HapticName, number | readonly number[]> = {
  tap: 10,
  medium: 18,
  success: [10, 40, 10],
  warning: [30, 60, 30],
  longPress: 14,
};

/** What each outcome sounds and feels like; most are one or the other. */
export const responses: Record<
  FeedbackEvent,
  { cue?: CueName; haptic?: HapticName }
> = {
  create: { cue: "create", haptic: "success" },
  complete: { cue: "complete", haptic: "success" },
  status: { cue: "status", haptic: "tap" },
  edit: { haptic: "tap" },
  due: { cue: "status", haptic: "tap" },
  pickup: { haptic: "medium" },
  drop: { cue: "drop", haptic: "medium" },
  comment: { cue: "comment", haptic: "tap" },
  undo: { cue: "undo", haptic: "tap" },
  error: { cue: "error", haptic: "warning" },
  destructive: { haptic: "warning" },
  palette: { cue: "palette" },
  select: { haptic: "tap" },
  longPress: { haptic: "longPress" },
};

/**
 * The one outcome of an edit, however many issues it touched: moving work
 * into a completed status is a completion, any other status a status
 * change, a due date a soft click like a status, everything else a plain
 * edit.
 */
export function editOutcome(
  kind: string,
  stateType: string | undefined,
): FeedbackEvent | undefined {
  // Typing is its own feedback; a saved title or description needs none.
  if (kind === "title" || kind === "description") {
    return undefined;
  }
  if (kind === "due") {
    return "due";
  }
  if (kind !== "state") {
    return "edit";
  }
  return stateType === "completed" ? "complete" : "status";
}

/** Everything a cue depends on at the moment it would play. */
export type Conditions = {
  /** The person's switch for this channel. */
  enabled: boolean;
  /** The system asks for reduced motion: feedback stays silent too. */
  reducedMotion: boolean;
  /** A hidden tab is not where the person's attention is. */
  hidden: boolean;
  /** Nothing plays before the page has had a user gesture. */
  gestured: boolean;
};

export function allowed(conditions: Conditions) {
  return (
    conditions.enabled &&
    !conditions.reducedMotion &&
    !conditions.hidden &&
    conditions.gestured
  );
}

/** Minimum gap between two cues of a channel, in milliseconds. */
export const minimumGap = 40;

/**
 * Keeps one channel's cues at least `gap` apart. One arriving too soon waits
 * for the gap instead of overlapping, so an error right after the edit that
 * caused it is still heard; while one waits, a newer one replaces it, so a
 * burst never queues up.
 */
export function createPacer(
  gap: number,
  clock: { now: () => number; later: (run: () => void, ms: number) => void },
) {
  let last = Number.NEGATIVE_INFINITY;
  let waiting: (() => void) | undefined;
  const play = (run: () => void) => {
    last = clock.now();
    run();
  };
  return (run: () => void) => {
    const wait = last + gap - clock.now();
    if (waiting !== undefined) {
      waiting = run;
      return;
    }
    if (wait <= 0) {
      play(run);
      return;
    }
    waiting = run;
    clock.later(() => {
      const next = waiting;
      waiting = undefined;
      if (next !== undefined) {
        play(next);
      }
    }, wait);
  };
}

export type Channel = "sound" | "haptics";

export type FeedbackPorts = {
  conditions: (channel: Channel) => Conditions;
  now: () => number;
  later: (run: () => void, ms: number) => void;
  play: (cue: CueName) => void;
  vibrate: (pattern: number | readonly number[]) => void;
};

/**
 * Turn an outcome into at most one cue and one vibration, each subject to
 * its switch, reduced motion, tab visibility, a first gesture and the
 * pacing. One call is one outcome: a bulk action calls it once.
 */
export function createFeedback(ports: FeedbackPorts) {
  const pace = {
    sound: createPacer(minimumGap, ports),
    haptics: createPacer(minimumGap, ports),
  };
  return (event: FeedbackEvent) => {
    const { cue, haptic } = responses[event];
    if (cue !== undefined && allowed(ports.conditions("sound"))) {
      pace.sound(() => {
        ports.play(cue);
      });
    }
    if (haptic !== undefined && allowed(ports.conditions("haptics"))) {
      pace.haptics(() => {
        ports.vibrate(hapticPatterns[haptic]);
      });
    }
  };
}
