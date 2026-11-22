import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ExactTime,
  RelativeTime,
  clockTime,
  exactTime,
  titleTime,
  zoneLabel,
} from "./time.tsx";

const MOMENT = "2026-11-21T19:27:03.000Z";

/** The parts a formatted moment shows, in the reader's own zone and locale. */
function parts(iso: string, options: Intl.DateTimeFormatOptions) {
  return Object.fromEntries(
    new Intl.DateTimeFormat(undefined, options)
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
}

describe("exactTime", () => {
  it("shows a local date and a 24-hour clock, to the minute or the second", () => {
    const local = parts(MOMENT, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const minute = exactTime(MOMENT);
    expect(minute).toContain(
      `${String(local["hour"])}:${String(local["minute"])}`,
    );
    expect(minute).not.toMatch(/\b(?:AM|PM)\b|T\d|Z$/u);
    expect(minute).not.toContain(`:${String(local["second"])}`);
    expect(exactTime(MOMENT, "second")).toContain(
      `${String(local["hour"])}:${String(local["minute"])}:${String(local["second"])}`,
    );
    expect(exactTime(MOMENT)).toContain("2026");
  });
});

describe("clockTime", () => {
  it("shows only the clock on the same local day, and the date on another", () => {
    const at = Date.parse(MOMENT) + 60_000;
    expect(clockTime(MOMENT, at)).not.toContain("2026");
    expect(clockTime(MOMENT, at)).toMatch(/^\d{2}:\d{2}:\d{2}$/u);
    expect(clockTime(MOMENT, at + 3 * 86_400_000)).toBe(
      exactTime(MOMENT, "second"),
    );
  });
});

describe("zoneLabel", () => {
  it("names the reader's zone as its offset from UTC, and a title carries it", () => {
    const zone = zoneLabel(MOMENT);
    expect(zone).toMatch(/^UTC(?:[+-]\d{1,2}(?::\d{2})?)?$/u);
    expect(titleTime(MOMENT)).toBe(`${exactTime(MOMENT, "second")} ${zone}`);
  });
});

describe("time elements", () => {
  it("a relative time keeps the exact moment in its title, and shows its clock when asked", () => {
    const plain = renderToStaticMarkup(<RelativeTime value={MOMENT} />);
    expect(plain).toContain(`title="${titleTime(MOMENT)}"`);
    expect(plain).not.toContain('class="clock"');
    const clock = renderToStaticMarkup(<RelativeTime value={MOMENT} clock />);
    expect(clock).toContain('<span class="clock">');
    expect(clock).toContain('<span aria-hidden="true"> · </span>');
  });

  it("an exact time shows the app's format, and how far off a future one is", () => {
    const past = renderToStaticMarkup(<ExactTime value={MOMENT} />);
    expect(past).toContain(`>${exactTime(MOMENT)}</time>`);
    const future = new Date(Date.now() + 6 * 3_600_000).toISOString();
    const ahead = renderToStaticMarkup(<ExactTime value={future} />);
    expect(ahead).toContain(exactTime(future));
    expect(ahead).toContain("in 6 hours");
  });
});
