import { describe, expect, test } from "vitest";
import type { ErrorEvent, StackFrame } from "@sentry/react";
import { filterScoutAppBugsinkEvent } from "#src/lib/bugsink-filters.ts";

function frame(filename: string): StackFrame {
  return { filename };
}

function eventWithFrames(filenames: string[]): ErrorEvent {
  return {
    type: undefined,
    event_id: "test",
    exception: {
      values: [
        { stacktrace: { frames: filenames.map((name) => frame(name)) } },
      ],
    },
  };
}

const APP_FRAME = "https://scout-for-lol.com/_astro/app.js";
const EXTENSION_FRAME =
  "chrome-extension://eppiocemhmnlbhjplcgkofciiegomcon/executors/200.js";

describe("filterScoutAppBugsinkEvent", () => {
  test("drops an event thrown from extension code", () => {
    const result = filterScoutAppBugsinkEvent(
      eventWithFrames([APP_FRAME, EXTENSION_FRAME]),
    );
    expect(result).toBeNull();
  });

  test("drops an event running under an extension entrypoint", () => {
    const result = filterScoutAppBugsinkEvent(
      eventWithFrames([EXTENSION_FRAME, APP_FRAME]),
    );
    expect(result).toBeNull();
  });

  test("keeps app errors with extension frames only in the middle", () => {
    const event = eventWithFrames([APP_FRAME, EXTENSION_FRAME, APP_FRAME]);
    const result = filterScoutAppBugsinkEvent(event);
    expect(result).toEqual(event);
  });

  test("keeps events without frames", () => {
    const event: ErrorEvent = { type: undefined, event_id: "test" };
    expect(filterScoutAppBugsinkEvent(event)).toEqual(event);
  });
});
