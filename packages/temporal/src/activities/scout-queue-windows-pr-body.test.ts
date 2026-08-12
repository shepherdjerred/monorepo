import { describe, expect, test } from "bun:test";
import {
  buildPrBody,
  canAutoMerge,
} from "#activities/scout-queue-windows-pr-body.ts";

const NO_PATCH_NOTES = { titles: [] };

function report(overrides: {
  edits?: {
    queue: string;
    kind: "open" | "reopen" | "close";
    date: string;
    message: string;
  }[];
  warnings?: { kind: string; message: string }[];
  unknownQueueIds?: { queueId: string; total: number }[];
}) {
  return {
    edits: overrides.edits ?? [],
    warnings: overrides.warnings ?? [],
    unknownQueueIds: overrides.unknownQueueIds ?? [],
    patchNotes: NO_PATCH_NOTES,
  };
}

describe("canAutoMerge", () => {
  test("allows additive-only edits", () => {
    expect(
      canAutoMerge([
        { queue: "urf", kind: "open", date: "2026-07-12", message: "m" },
        { queue: "arena", kind: "reopen", date: "2026-07-01", message: "m" },
      ]),
    ).toBe(true);
  });

  test("refuses when any edit closes a window", () => {
    // A close retires a live mode; it must be confirmed against patch notes.
    expect(
      canAutoMerge([
        { queue: "urf", kind: "open", date: "2026-07-12", message: "m" },
        { queue: "arena", kind: "close", date: "2026-07-08", message: "m" },
      ]),
    ).toBe(false);
  });

  test("refuses an empty edit list", () => {
    expect(canAutoMerge([])).toBe(false);
  });
});

describe("buildPrBody markdown safety", () => {
  test("escapes a pipe in a queue name so the table survives", () => {
    // The Doom Bots trio renders as a `/`-joined name today, but any engine
    // message containing a `|` would silently break every row after it.
    const body = buildPrBody(
      report({
        edits: [
          {
            queue: "easy doom bots",
            kind: "open",
            date: "2026-07-06",
            message: "opened window | with a pipe",
          },
        ],
      }),
      true,
    );

    const row = body.split("\n").find((line) => line.includes("opened window"));
    expect(row).toBeDefined();
    expect(row).toContain(String.raw`\|`);
    // Four cells means five delimiters; an unescaped pipe would make six.
    expect(row?.split(/(?<!\\)\|/).length).toBe(6);
  });

  test("flattens a newline in a message onto one row", () => {
    const body = buildPrBody(
      report({
        edits: [
          {
            queue: "urf",
            kind: "close",
            date: "2026-07-08",
            message: "line one\nline two",
          },
        ],
      }),
      false,
    );
    expect(body).toContain("line one line two");
    expect(body).not.toContain("line one\nline two");
  });
});

describe("buildPrBody surfaces unmapped queue ids", () => {
  test("renders the ids the watcher could not classify", () => {
    // These were parsed off the report and then dropped on the floor — the
    // "new mode?" signal never reached the human reading the PR.
    const body = buildPrBody(
      report({
        edits: [
          { queue: "urf", kind: "open", date: "2026-07-12", message: "m" },
        ],
        unknownQueueIds: [
          { queueId: "4200", total: 12 },
          { queueId: "999999", total: 4 },
        ],
      }),
      true,
    );

    expect(body).toContain("## Unmapped queue ids");
    expect(body).toContain("| 4200 | 12 |");
    expect(body).toContain("| 999999 | 4 |");
  });

  test("omits the section entirely when every id mapped", () => {
    const body = buildPrBody(
      report({
        edits: [
          { queue: "urf", kind: "open", date: "2026-07-12", message: "m" },
        ],
      }),
      true,
    );
    expect(body).not.toContain("## Unmapped queue ids");
  });
});
