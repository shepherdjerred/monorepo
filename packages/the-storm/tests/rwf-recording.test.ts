import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readOccurrence } from "./e2e/harness/rwf-occurrences.ts";
import { readTrails } from "./e2e/harness/rwf-trails.ts";
import { readRecording } from "./e2e/harness/rwfbots.ts";

const wire = await readFile(
  new URL(
    "../plugin/modules/rwf/src/test/resources/schema-4-occurrences.json",
    import.meta.url,
  ),
  "utf8",
);
const fixture = z.array(z.string()).nonempty().parse(JSON.parse(wire));

describe("schema 4 occurrence contract", () => {
  it("retains every shared Java/Python row and uses structured kills as contact", () => {
    const trails = readTrails(["H\t4\tmatch\tyard", ...fixture]);
    expect(trails.occurrences).toHaveLength(10);
    expect(new Set(trails.occurrences.map(([tag]) => tag))).toEqual(
      new Set(["B", "J", "A", "U", "K", "C", "V", "D", "S"]),
    );
    expect(trails.occurrences[0]).toEqual([
      "V",
      0,
      "yard",
      "yard",
      "2",
      "other",
      "1",
    ]);
    expect(trails.firstContact).toBe(4);
    expect(readRecording(["H\t4", ...fixture]).occurrences).toEqual(
      trails.occurrences,
    );
  });

  it.each([
    "V\t0\tyard\tyard\t2\tother",
    "V\t0\tyard\tyard\t-1",
    "V\t0\tyard\tother\t1",
    "V\t0\tyard\tyard\t1\tyard\t2",
    "V\t-1\tyard\tyard\t1",
    "S\t0\tUNKNOWN\tRED=1\tred-1=IDLE",
    "S\t0\tWAITING\tRED=1,RED=2\tred-1=IDLE",
    "J\t0\tp1\tarrow\tNaN\t0\t0\t0\t0\t0",
    "J\t0\tp1\tarrow\t \t0\t0\t0\t0\t0",
    "J\t0\tp1\tarrow\t0x10\t0\t0\t0\t0\t0",
    "J\t0\tp1\tarrow\t1e999\t0\t0\t0\t0\t0",
    "D\t0\tp1\tp2\tMelee\tiron_sword\t2\tp1=0.5",
    "D\t0\tp1\tp2\t   \tiron_sword\t2",
    "C\t0\tp2\tglobal\t3\tgg",
    "U\t0\tp1\tspeed\t1",
    "?\t0",
    "C\t0\tp2\tglobal\t2\t\\q",
  ])("rejects malformed occurrence %s", (row) => {
    expect(() => readOccurrence(row.split("\t"))).toThrow();
  });

  it("rejects schema drift and unknown rows in each recording consumer", () => {
    for (const reader of [readTrails, readRecording]) {
      expect(() => reader(["H\t3\tmatch\tyard", ...fixture])).toThrow(
        "schema 4",
      );
      expect(() => reader(["H\t4\tmatch\tyard", "?\t0"])).toThrow(
        "unknown recording row",
      );
    }
  });

  it("decodes escaped bot chat before checking its recorded length", () => {
    expect(
      readOccurrence("C\t4\tp2\tglobal\t14\tgg\\tno\\\\re\\nmatch".split("\t")),
    ).toEqual(["C", 4, "p2", "global", 14, "gg\tno\\re\nmatch"]);
  });
});
