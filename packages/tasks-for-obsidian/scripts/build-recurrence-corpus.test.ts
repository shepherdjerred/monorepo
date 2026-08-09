/**
 * Guards the recurrence parity corpus
 * (`packages/tasknotes-fixtures/recurrence/`).
 *
 * The Rust recurrence engine is asserted against these bytes, so a silent
 * change in `@tasknotes/model` / `rrule` would otherwise turn the oracle into
 * a lie. Regenerating here and comparing byte-for-byte makes a dependency bump
 * that alters ANY expansion fail loudly.
 */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { z } from "zod";

import {
  auditCorpus,
  buildCorpus,
  serializeCorpus,
  serializeManifest,
  tzProbeDigest,
} from "./build-recurrence-corpus.ts";

/** Regenerating the corpus drives a real rrule engine ~1700 times. */
const GENERATION_TIMEOUT_MS = 300_000;

const CORPUS_PATH = new URL(
  "../../tasknotes-fixtures/recurrence/corpus.jsonl",
  import.meta.url,
).pathname;
const MANIFEST_PATH = new URL(
  "../../tasknotes-fixtures/recurrence/manifest.json",
  import.meta.url,
).pathname;
const SCHEMA_PATH = new URL(
  "../../tasknotes-fixtures/recurrence/corpus.schema.json",
  import.meta.url,
).pathname;
const SCRIPT_PATH = new URL("build-recurrence-corpus.ts", import.meta.url)
  .pathname;

const CorpusRowSchema = z.object({
  dateCreated: z.string().nullable(),
  finiteInstanceCount: z.number().nullable(),
  firstOccurrence: z.string().nullable(),
  generatorDayCount: z.number(),
  group: z.string(),
  id: z.string(),
  lastOccurrence: z.string().nullable(),
  nextUncompletedCompletionAnchor: z.string().nullable(),
  nextUncompletedScheduledAnchor: z.string().nullable(),
  note: z.string().nullable(),
  occurrenceCount: z.number(),
  occurrences: z.array(z.string()),
  outcome: z.enum(["always", "expanded"]),
  recurrence: z.string(),
  scheduled: z.string().nullable(),
  source: z.enum(["edge", "generated", "harvested"]),
});

type CorpusRow = z.infer<typeof CorpusRowSchema>;

const ManifestSchema = z.object({
  anchorDate: z.string(),
  caseCount: z.number(),
  corpusSha256: z.string(),
  edgeCaseCount: z.number(),
  failOpenCaseCount: z.number(),
  failOpenProbeDate: z.string(),
  generatedBy: z.string(),
  generatedCaseCount: z.number(),
  harvestedCaseCount: z.number(),
  modelEntryPoint: z.string(),
  occurrenceDateCount: z.number(),
  windowDays: z.number(),
  windowEnd: z.string(),
  windowStart: z.string(),
});

/**
 * Only the parts of `corpus.schema.json` this suite pins. Validating the data
 * against the full JSON Schema needs a validator the app does not depend on;
 * what actually rots is the schema falling behind the generator, and that is
 * exactly what comparing key sets catches.
 */
const SchemaShapeSchema = z.object({
  $defs: z.object({
    case: z.object({
      properties: z.record(z.string(), z.unknown()),
      required: z.array(z.string()),
    }),
    manifest: z.object({
      properties: z.record(z.string(), z.unknown()),
      required: z.array(z.string()),
    }),
  }),
});

function parseRows(text: string): CorpusRow[] {
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => CorpusRowSchema.parse(JSON.parse(line)));
}

function findRow(
  rows: readonly CorpusRow[],
  predicate: (row: CorpusRow) => boolean,
): CorpusRow {
  const match = rows.find((row) => predicate(row));
  if (match === undefined) throw new Error("no corpus row matched");
  return match;
}

async function committedCorpus(): Promise<string> {
  return Bun.file(CORPUS_PATH).text();
}

test(
  "the committed corpus is exactly what the generator produces today",
  async () => {
    const cases = buildCorpus();
    const corpusText = serializeCorpus(cases);
    const manifestText = serializeManifest(cases, corpusText);

    expect(await committedCorpus()).toBe(corpusText);
    expect(await Bun.file(MANIFEST_PATH).text()).toBe(manifestText);
  },
  GENERATION_TIMEOUT_MS,
);

test(
  "the whole-window shortcut agrees with per-day shouldShowRecurringTaskOnDate",
  async () => {
    const rows = parseRows(await committedCorpus());
    // Re-derive the cases rather than trusting the file, then audit the two
    // entry points against each other on the boundary days.
    const cases = buildCorpus();
    expect(cases.length).toBe(rows.length);
    const report = auditCorpus(cases);
    expect(report.checkedPairs).toBeGreaterThan(10_000);
  },
  GENERATION_TIMEOUT_MS,
);

test(
  "expansion is timezone-free and reproducible across processes",
  async () => {
    // Offsets on both sides of UTC, including UTC+14. Identical digests prove
    // contract note 1 (naive-date arithmetic, no DST) AND cross-process
    // determinism, since every run is a separate `bun` process.
    const zones = [
      "UTC",
      "America/Los_Angeles",
      "Asia/Tokyo",
      "Pacific/Kiritimati",
    ];
    const digests: string[] = [];
    for (const zone of zones) {
      const proc = Bun.spawn(["bun", SCRIPT_PATH, "--tz-probe"], {
        env: { ...process.env, TZ: zone },
        stderr: "pipe",
        stdout: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`--tz-probe failed under TZ=${zone}: ${stderr}`);
      }
      digests.push(stdout.trim());
    }
    const expected = tzProbeDigest();
    expect(digests).toEqual(zones.map(() => expected));
  },
  GENERATION_TIMEOUT_MS,
);

test("the manifest digest covers the corpus file", async () => {
  const corpusText = await committedCorpus();
  const manifest = ManifestSchema.parse(
    JSON.parse(await Bun.file(MANIFEST_PATH).text()),
  );
  expect(manifest.corpusSha256).toBe(
    createHash("sha256").update(corpusText).digest("hex"),
  );
  expect(manifest.anchorDate).toBe("2026-01-01");
  expect(manifest.windowStart).toBe("2021-01-01");
  expect(manifest.windowEnd).toBe("2030-12-31");
  expect(manifest.windowDays).toBe(3652);
  expect(manifest.caseCount).toBe(parseRows(corpusText).length);
});

test("every occurrence list is sorted, unique, and inside the window", async () => {
  const rows = parseRows(await committedCorpus());
  expect(rows.length).toBeGreaterThan(200);
  for (const row of rows) {
    let previous = "";
    for (const date of row.occurrences) {
      expect(date > previous).toBe(true);
      expect(date >= "2021-01-01").toBe(true);
      expect(date <= "2030-12-31").toBe(true);
      previous = date;
    }
    if (row.outcome === "always") {
      // Fail-open cases are true on EVERY date, so listing them would just be
      // the window; the count records that and the list stays empty.
      expect(row.occurrences.length).toBe(0);
      expect(row.occurrenceCount).toBe(3652);
    } else {
      expect(row.occurrenceCount).toBe(row.occurrences.length);
    }
  }
});

test("the published JSON Schema still describes what the generator emits", async () => {
  const schema = SchemaShapeSchema.parse(
    JSON.parse(await Bun.file(SCHEMA_PATH).text()),
  );
  const rows = parseRows(await committedCorpus());

  const anyObject = z.record(z.string(), z.unknown());
  const corpusText = await committedCorpus();
  const emittedCaseKeys = new Set<string>();
  for (const line of corpusText.split("\n")) {
    if (line === "") continue;
    for (const key of Object.keys(anyObject.parse(JSON.parse(line)))) {
      emittedCaseKeys.add(key);
    }
  }
  const caseKeys = [...emittedCaseKeys].sort();
  expect(Object.keys(schema.$defs.case.properties).sort()).toEqual(caseKeys);
  expect([...schema.$defs.case.required].sort()).toEqual(caseKeys);

  const manifestText = await Bun.file(MANIFEST_PATH).text();
  const manifestKeys = Object.keys(
    anyObject.parse(JSON.parse(manifestText)),
  ).sort();
  expect(Object.keys(schema.$defs.manifest.properties).sort()).toEqual(
    manifestKeys,
  );
  expect([...schema.$defs.manifest.required].sort()).toEqual(manifestKeys);

  // The enums are closed sets, so they must list every value in the data.
  const groupEnum = z
    .object({ enum: z.array(z.string()) })
    .parse(schema.$defs.case.properties["group"]);
  const sourceEnum = z
    .object({ enum: z.array(z.string()) })
    .parse(schema.$defs.case.properties["source"]);
  expect([...groupEnum.enum].sort()).toEqual(
    [...new Set(rows.map((row) => row.group))].sort(),
  );
  expect([...sourceEnum.enum].sort()).toEqual(
    [...new Set(rows.map((row) => row.source))].sort(),
  );
});

test("case ids are unique and the file is sorted by id", async () => {
  const rows = parseRows(await committedCorpus());
  const ids = rows.map((row) => row.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual([...ids].sort());
});

test("an empty rule fails OPEN — the task stays visible", async () => {
  const rows = parseRows(await committedCorpus());
  const empty = findRow(
    rows,
    (row) => row.recurrence === "" && row.scheduled !== null,
  );
  expect(empty.outcome).toBe("always");
  // The second entry point disagrees: generateRecurringInstances bails out
  // with [] before its own try/catch when `recurrence` is falsy.
  expect(empty.generatorDayCount).toBe(0);
});

test("unparseable rules fail OPEN", async () => {
  const rows = parseRows(await committedCorpus());
  for (const recurrence of [
    "garbage",
    "FREQ=NONSENSE",
    "FREQ=",
    "FREQ=WEEKLY;BYDAY=XX",
    "FREQ=DAILY;UNTIL=notadate",
  ]) {
    const row = findRow(
      rows,
      (candidate) =>
        candidate.recurrence === recurrence && candidate.scheduled !== null,
    );
    expect(row.outcome).toBe("always");
  }
});

test("a missing DTSTART source fails CLOSED, even for a garbage rule", async () => {
  const rows = parseRows(await committedCorpus());
  for (const recurrence of ["FREQ=DAILY", "garbage", "FREQ=NONSENSE"]) {
    const row = findRow(
      rows,
      (candidate) =>
        candidate.recurrence === recurrence &&
        candidate.scheduled === null &&
        candidate.dateCreated === null,
    );
    expect(row.outcome).toBe("expanded");
    expect(row.occurrences.length).toBe(0);
  }
  // ...except the empty rule, whose short circuit runs before the
  // missing-DTSTART check.
  const empty = findRow(
    rows,
    (row) =>
      row.recurrence === "" &&
      row.scheduled === null &&
      row.dateCreated === null,
  );
  expect(empty.outcome).toBe("always");
});

test("YEARLY;BYMONTHDAY expands into every month, not DTSTART's month", async () => {
  const rows = parseRows(await committedCorpus());
  const yearly = findRow(
    rows,
    (row) => row.recurrence === "FREQ=YEARLY;BYMONTHDAY=20",
  );
  // RFC 5545 would give five occurrences (one per year from DTSTART).
  // rrule.js gives one per month.
  expect(yearly.occurrenceCount).toBe(60);
  expect(yearly.occurrences.slice(0, 3)).toEqual([
    "2026-01-20",
    "2026-02-20",
    "2026-03-20",
  ]);
});

test("both ends of the day window are inclusive", async () => {
  const rows = parseRows(await committedCorpus());
  // A rule whose DTSTART is the window's last day still occurs on that day,
  // which only holds because `between` is inclusive on the upper bound.
  const lateStart = findRow(
    rows,
    (row) => row.recurrence === "DTSTART:20301230;FREQ=DAILY",
  );
  expect(lateStart.occurrences).toEqual(["2030-12-30", "2030-12-31"]);
});

test("the corpus covers every input family and both real and synthetic rules", async () => {
  const rows = parseRows(await committedCorpus());
  const groups = new Set(rows.map((row) => row.group));
  for (const group of [
    "harvested",
    "freq-interval",
    "byday-single",
    "byday-multi",
    "byday-nth",
    "bymonthday",
    "bysetpos",
    "bymonth",
    "byyearday",
    "byweekno",
    "wkst",
    "termination",
    "sub-daily",
    "dtstart",
    "malformed",
  ]) {
    expect(groups.has(group)).toBe(true);
  }
  expect(rows.filter((row) => row.source === "harvested").length).toBe(6);
  expect(rows.filter((row) => row.source === "edge").length).toBeGreaterThan(
    30,
  );
  expect(rows.filter((row) => row.outcome === "always").length).toBeGreaterThan(
    10,
  );
});
