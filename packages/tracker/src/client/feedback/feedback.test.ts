import { describe, expect, test } from "vitest";
import {
  cueLength,
  cueNames,
  cueSignature,
  cues,
  maxCueSeconds,
  maxGain,
  type CueName,
} from "./cues.ts";
import {
  createFeedback,
  createPacer,
  editOutcome,
  hapticPatterns,
  responses,
  type Conditions,
  type FeedbackEvent,
} from "./policy.ts";
import { createPreferences, preferenceKeys } from "./preferences.ts";

const open: Conditions = {
  enabled: true,
  reducedMotion: false,
  hidden: false,
  gestured: true,
};

/** A clock that only moves when told to, running timers as it passes them. */
function manualClock() {
  let time = 0;
  let timers: { at: number; run: () => void }[] = [];
  return {
    now: () => time,
    later: (run: () => void, ms: number) => {
      timers.push({ at: time + ms, run });
    },
    advance(ms: number) {
      time += ms;
      const due = timers.filter(({ at }) => at <= time);
      timers = timers.filter(({ at }) => at > time);
      for (const timer of due) {
        timer.run();
      }
    },
  };
}

function harness(
  overrides: Partial<Record<"sound" | "haptics", Partial<Conditions>>> = {},
) {
  const clock = manualClock();
  const played: CueName[] = [];
  const vibrations: (number | readonly number[])[] = [];
  const feedback = createFeedback({
    conditions: (channel) => ({ ...open, ...overrides[channel] }),
    now: clock.now,
    later: clock.later,
    play: (cue) => played.push(cue),
    vibrate: (pattern) => vibrations.push(pattern),
  });
  return {
    played,
    vibrations,
    clock,
    send(event: FeedbackEvent, after = 100) {
      clock.advance(after);
      feedback(event);
    },
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("feedback gating", () => {
  test("with the switches on, an outcome sounds and vibrates", () => {
    const run = harness();
    run.send("create");
    expect(run.played).toEqual(["create"]);
    expect(run.vibrations).toEqual([[10, 40, 10]]);
  });

  test("each switch silences only its own channel", () => {
    const quiet = harness({ sound: { enabled: false } });
    quiet.send("complete");
    expect(quiet.played).toEqual([]);
    expect(quiet.vibrations).toEqual([hapticPatterns.success]);
    const still = harness({ haptics: { enabled: false } });
    still.send("complete");
    expect(still.played).toEqual(["complete"]);
    expect(still.vibrations).toEqual([]);
  });

  test.each([
    ["reduced motion", { reducedMotion: true }],
    ["a hidden tab", { hidden: true }],
    ["no gesture yet", { gestured: false }],
  ] as const)("%s keeps both channels silent", (_, condition) => {
    const run = harness({ sound: condition, haptics: condition });
    run.send("error");
    run.send("drop");
    expect(run.played).toEqual([]);
    expect(run.vibrations).toEqual([]);
  });

  test("a cue inside the 40 ms gap waits for it; a newer one replaces it", () => {
    const run = harness();
    run.send("status");
    run.send("edit", 5);
    run.send("comment", 10);
    run.send("error", 10);
    // Only the first has sounded; the error waits for the gap.
    expect(run.played).toEqual(["status"]);
    run.clock.advance(14);
    expect(run.played).toEqual(["status"]);
    run.clock.advance(1);
    expect(run.played).toEqual(["status", "error"]);
    run.send("status", 41);
    expect(run.played).toEqual(["status", "error", "status"]);
  });

  test("an edit has one outcome however many issues it touched", () => {
    expect(editOutcome("state", "completed")).toBe("complete");
    expect(editOutcome("state", "started")).toBe("status");
    expect(editOutcome("priority", undefined)).toBe("edit");
    expect(editOutcome("title", undefined)).toBeUndefined();
    expect(editOutcome("due", undefined)).toBe("due");
    expect(responses.due.cue).toBe("status");
    const run = harness();
    // A bulk apply over three issues reports its one outcome once.
    run.send("complete");
    expect(run.played).toEqual(["complete"]);
    expect(run.vibrations).toHaveLength(1);
  });

  test("pacing lets the first cue through at once", () => {
    const clock = manualClock();
    const pace = createPacer(40, clock);
    const ran: number[] = [];
    pace(() => ran.push(1));
    expect(ran).toEqual([1]);
    clock.advance(40);
    pace(() => ran.push(2));
    expect(ran).toEqual([1, 2]);
  });
});

function patternOf(event: FeedbackEvent) {
  const haptic = responses[event].haptic;
  return haptic === undefined ? undefined : hapticPatterns[haptic];
}

function refusing(): never {
  throw new DOMException("Blocked", "SecurityError");
}

describe("haptic patterns", () => {
  test("each outcome maps to its documented pattern", () => {
    expect(patternOf("select")).toBe(10);
    expect(patternOf("pickup")).toBe(18);
    expect(patternOf("drop")).toBe(18);
    expect(patternOf("create")).toEqual([10, 40, 10]);
    expect(patternOf("complete")).toEqual([10, 40, 10]);
    expect(patternOf("error")).toEqual([30, 60, 30]);
    expect(patternOf("destructive")).toEqual([30, 60, 30]);
    expect(patternOf("longPress")).toBe(14);
    expect(patternOf("palette")).toBeUndefined();
  });
});

describe("cues", () => {
  test.each(cueNames)("%s is short and quiet", (name) => {
    expect(cueLength(name)).toBeLessThanOrEqual(maxCueSeconds);
    for (const part of cues[name]) {
      expect(part.gain).toBeLessThanOrEqual(maxGain);
      expect(part.gain).toBeGreaterThan(0);
    }
  });

  test("every cue can be told apart from outside the audio graph", () => {
    const signatures = cueNames.map((name) => cueSignature(name).join(" "));
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  test("undo plays the create rise backwards", () => {
    expect(cueSignature("undo")).toEqual([...cueSignature("create")].reverse());
  });
});

describe("feedback preferences", () => {
  test("both switches are on until this device turns one off", () => {
    const storage = memoryStorage();
    const preferences = createPreferences(() => storage);
    expect(preferences.read("sound")).toBe(true);
    expect(preferences.read("haptics")).toBe(true);
    preferences.write("sound", false);
    expect(storage.values.get(preferenceKeys.sound)).toBe("off");
    // A reload reads the same storage.
    const reloaded = createPreferences(() => storage);
    expect(reloaded.read("sound")).toBe(false);
    expect(reloaded.read("haptics")).toBe(true);
  });

  test("storage that refuses access defaults on and still switches for the visit", () => {
    const preferences = createPreferences(() => ({
      getItem: refusing,
      setItem: refusing,
    }));
    expect(preferences.read("haptics")).toBe(true);
    let changes = 0;
    preferences.subscribe(() => {
      changes += 1;
    });
    expect(() => {
      preferences.write("haptics", false);
    }).not.toThrow();
    expect(preferences.read("haptics")).toBe(false);
    expect(changes).toBe(1);
  });
});
