#!/usr/bin/env bun
/**
 * Recurrence differential corpus — the parity oracle for the hand-rolled Rust
 * recurrence engine (plan `2026-08-08_tasknotes-native-macos-app.md`, phase 0c
 * feeding phase 2).
 *
 * WHAT THIS SNAPSHOTS
 * -------------------
 * The app never touches an rrule engine directly. `src/domain/recurrence.ts`
 * calls `shouldShowRecurringTaskOnDate` from `tasknotes-types/v2`, which
 * re-exports `@tasknotes/model`, which wraps `rrule`. This script drives that
 * exact entry point over a fixed ±5-year window and writes the answer to
 * `packages/tasknotes-fixtures/recurrence/`. The Rust port asserts against
 * those bytes; if a dependency bump changes an expansion, the committed corpus
 * stops matching and CI fails loudly.
 *
 * THE CONTRACT, AS READ OUT OF @tasknotes/model@0.2.x `dist/esm/recurrence.js`
 * --------------------------------------------------------------------------
 * 1. TIMEZONE-FREE. `createRRule` strips `DTSTART:` from the rule string and
 *    substitutes `Date.UTC(y, m, d, 0, 0, 0, 0)`; `formatDateForStorage` reads
 *    the result back with `getUTC*`. `tzid` is never set. Given UTC-midnight
 *    input the answer is naive-date arithmetic with no DST — verified here by
 *    `--audit`, which additionally re-runs a slice under several `TZ` values.
 * 2. INCLUSIVE ON BOTH ENDS. `isDueByRRule` asks
 *    `rule.between(dayStart, dayStart + 86_400_000 - 1, inc)` with `inc` true.
 *    Rust's `between` idiom is half-open; that difference is a guaranteed
 *    off-by-one unless it is replicated.
 * 3. FAIL OPEN. `isDueByRRule` wraps the expansion in `try/catch { return true }`
 *    and short-circuits `if (!task.recurrence) return true`. An unparseable or
 *    empty rule means SHOW THE TASK. Corpus cases with `outcome: "always"`
 *    encode that; a Rust port that returns `false` on a parse error makes
 *    tasks silently vanish.
 * 4. FAIL CLOSED ON A MISSING DTSTART. This one is NOT symmetric with (3) and
 *    is easy to miss: `createRRule` returns `null` when no `DTSTART:` is
 *    embedded and neither `scheduled` nor `dateCreated` is set, and
 *    `isDueByRRule` then returns `false` — before any parsing happens, so even
 *    a garbage rule string is fail-CLOSED in that shape.
 *
 * USAGE
 * -----
 *   bun scripts/build-recurrence-corpus.ts --write     # regenerate + audit
 *   bun scripts/build-recurrence-corpus.ts --check     # fail on drift
 *   bun scripts/build-recurrence-corpus.ts --audit     # equivalence audit only
 *   bun scripts/build-recurrence-corpus.ts --tz-probe  # digest of a TZ-sensitive slice
 *
 * DETERMINISM: a fixed anchor date, no `Date.now()`, no wall clock, no RNG,
 * sorted case ids, and NDJSON with sorted object keys. Two runs are
 * byte-identical.
 *
 * WHY NDJSON: `.prettierignore` does not cover the fixtures package and
 * Prettier reflows short JSON arrays, so a pretty-printed `.json` corpus could
 * not be byte-stable against the repo formatter. Prettier infers no parser for
 * `.jsonl`, so the corpus stays exactly as generated. The sidecar
 * `manifest.json` is a flat scalar-only object, which Prettier leaves alone.
 * `recurrence/corpus.schema.json` documents both files.
 */

import { createHash } from "node:crypto";

import {
  generateRecurringInstances,
  getFiniteRecurringInstanceCount,
  getNextUncompletedOccurrence,
  shouldShowRecurringTaskOnDate,
  type RecurringTaskLike,
} from "tasknotes-types/v2";

import type { CaseInput, CaseSource } from "./recurrence-corpus-case.ts";
import {
  ANCHOR_DATE,
  addDays,
  daysBetween,
  toYmd,
  utcDate,
  WINDOW_END,
  WINDOW_START,
  YMD_PATTERN,
} from "./recurrence-corpus-dates.ts";
import {
  assertNoNonTerminatingRules,
  edgeCases,
  harvestedCases,
} from "./recurrence-corpus-edges.ts";
import { gridCases } from "./recurrence-corpus-grid.ts";

// ---------------------------------------------------------------------------
// Fixed frame of reference
// ---------------------------------------------------------------------------

/**
 * A day strictly before every DTSTART the corpus can resolve. rrule never
 * yields an occurrence before DTSTART, so a `true` answer here can only come
 * from the model's `catch { return true }` (or its empty-rule short circuit).
 * That makes this an EXACT fail-open discriminator expressed purely in terms
 * of the public model API — no reimplementation of `createRRule` required.
 * `assertProbeIsBeforeEveryDtstart` keeps the invariant honest.
 */
const FAIL_OPEN_PROBE_DATE = "2019-01-01";

const DTSTART_PATTERN = /DTSTART:(\d{4})(\d{2})(\d{2})/;

/**
 * The corpus is DATA and lives in the dependency-free, language-neutral
 * `@tasknotes/fixtures` package so the Rust core can consume it without
 * dragging a TypeScript dependency graph along. The GENERATOR stays here,
 * with the implementation it snapshots — it necessarily depends on
 * `tasknotes-types` → `@tasknotes/model` → rrule.js, and when the RN app
 * eventually migrates onto the Rust core the generator retires with it while
 * its frozen output does not.
 */
const FIXTURE_DIR = new URL(
  "../../tasknotes-fixtures/recurrence/",
  import.meta.url,
);
const CORPUS_PATH = new URL("corpus.jsonl", FIXTURE_DIR).pathname;
const MANIFEST_PATH = new URL("manifest.json", FIXTURE_DIR).pathname;

/** `scripts/check-large-files.ts` rejects tracked files over 5 MiB. */
const MAX_CORPUS_BYTES = 4 * 1_048_576;

function collectInputs(): CaseInput[] {
  return [...harvestedCases(), ...gridCases(), ...edgeCases()];
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

/** `expanded` means "occurs exactly on these dates"; `always` means fail-open. */
type Outcome = "always" | "expanded";

type CorpusCase = {
  readonly id: string;
  readonly group: string;
  readonly source: CaseSource;
  readonly note: string | null;
  readonly recurrence: string;
  readonly scheduled: string | null;
  readonly dateCreated: string | null;
  readonly outcome: Outcome;
  readonly occurrenceCount: number;
  readonly firstOccurrence: string | null;
  readonly lastOccurrence: string | null;
  /** `getFiniteRecurringInstanceCount`, which is null for infinite rules. */
  readonly finiteInstanceCount: number | null;
  /**
   * Distinct dates returned by `generateRecurringInstances` over the same
   * window. This is a SECOND, independent entry point in the same model, and
   * it does not always agree with `shouldShowRecurringTaskOnDate`: an empty
   * `recurrence` makes the show-check return true for every date while the
   * generator returns nothing at all. Recorded so the divergence is visible in
   * the data instead of being averaged away.
   */
  readonly generatorDayCount: number;
  /** `getNextUncompletedOccurrence` at ANCHOR_DATE, per recurrence anchor. */
  readonly nextUncompletedScheduledAnchor: string | null;
  readonly nextUncompletedCompletionAnchor: string | null;
  /** Empty when `outcome` is `always`. */
  readonly occurrences: readonly string[];
};

function toTask(input: CaseInput): RecurringTaskLike {
  return {
    title: "recurrence-corpus",
    recurrence: input.recurrence,
    ...(input.scheduled === null ? {} : { scheduled: input.scheduled }),
    ...(input.dateCreated === null ? {} : { dateCreated: input.dateCreated }),
    complete_instances: [],
    skipped_instances: [],
    status: "open",
  };
}

/**
 * `generateRecurringInstances` is `rule.between(windowStart, windowEnd, true)`
 * with the same fail-open catch as `isDueByRRule`, so a single call over the
 * whole window yields exactly the day set that per-day `between` calls would
 * produce — three orders of magnitude faster. `auditCorpus` proves the two
 * agree rather than assuming it.
 */
function expandDays(task: RecurringTaskLike): string[] {
  const instances = generateRecurringInstances(
    task,
    utcDate(WINDOW_START),
    utcDate(WINDOW_END),
  );
  const days: string[] = [];
  let previous = "";
  for (const instance of instances) {
    const day = toYmd(instance);
    if (day === previous) continue;
    if (previous !== "" && day < previous) {
      throw new Error(
        `expansion is not ascending: "${day}" follows "${previous}"`,
      );
    }
    days.push(day);
    previous = day;
  }
  return days;
}

function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return cleaned === "" ? "empty" : cleaned;
}

function buildCase(input: CaseInput, ordinal: number): CorpusCase {
  const task = toTask(input);
  const failsOpen = shouldShowRecurringTaskOnDate(
    task,
    utcDate(FAIL_OPEN_PROBE_DATE),
  );
  const days = expandDays(task);
  const windowDays = daysBetween(WINDOW_START, WINDOW_END) + 1;

  // `generateRecurringInstances` bails out with `[]` before its try/catch when
  // `recurrence` is falsy, so the empty rule is the one shape where the two
  // model entry points legitimately disagree. Everywhere else a fail-open
  // probe must mean the generator's own catch-branch covered every window day.
  if (failsOpen && input.recurrence !== "" && days.length !== windowDays) {
    throw new Error(
      `case "${input.recurrence}" probes as fail-open but expands to ${String(days.length)} of ${String(windowDays)} window days`,
    );
  }
  if (!failsOpen && input.recurrence === "") {
    throw new Error("an empty rule must probe as fail-open");
  }

  const outcome: Outcome = failsOpen ? "always" : "expanded";
  const occurrences = failsOpen ? [] : days;

  const nextScheduledAnchor = getNextUncompletedOccurrence(task, {
    today: ANCHOR_DATE,
  });
  const nextCompletionAnchor = getNextUncompletedOccurrence(
    { ...task, recurrence_anchor: "completion" },
    { today: ANCHOR_DATE },
  );

  return {
    id: `${String(ordinal).padStart(4, "0")}-${input.group}-${slug(input.recurrence).slice(0, 60)}`,
    group: input.group,
    source: input.source,
    note: input.note,
    recurrence: input.recurrence,
    scheduled: input.scheduled,
    dateCreated: input.dateCreated,
    outcome,
    occurrenceCount: failsOpen ? windowDays : days.length,
    firstOccurrence: days[0] ?? null,
    lastOccurrence: days.at(-1) ?? null,
    finiteInstanceCount: getFiniteRecurringInstanceCount(task),
    generatorDayCount: days.length,
    nextUncompletedScheduledAnchor:
      nextScheduledAnchor === null ? null : toYmd(nextScheduledAnchor),
    nextUncompletedCompletionAnchor:
      nextCompletionAnchor === null ? null : toYmd(nextCompletionAnchor),
    occurrences,
  };
}

function assertProbeIsBeforeEveryDtstart(inputs: readonly CaseInput[]): void {
  for (const input of inputs) {
    const candidates: string[] = [];
    const embedded = DTSTART_PATTERN.exec(input.recurrence);
    if (embedded !== null) {
      candidates.push(
        `${input.recurrence.slice(embedded.index + 8, embedded.index + 12)}-${input.recurrence.slice(embedded.index + 12, embedded.index + 14)}-${input.recurrence.slice(embedded.index + 14, embedded.index + 16)}`,
      );
    }
    if (input.scheduled !== null) candidates.push(input.scheduled.slice(0, 10));
    if (input.dateCreated !== null) {
      candidates.push(input.dateCreated.slice(0, 10));
    }
    for (const candidate of candidates) {
      if (!YMD_PATTERN.test(candidate)) continue;
      if (candidate <= FAIL_OPEN_PROBE_DATE) {
        throw new Error(
          `DTSTART source "${candidate}" is not strictly after the fail-open probe date ${FAIL_OPEN_PROBE_DATE}; the probe would stop being an exact discriminator`,
        );
      }
    }
  }
}

export function buildCorpus(): CorpusCase[] {
  const inputs = collectInputs();
  assertNoNonTerminatingRules(inputs);
  assertProbeIsBeforeEveryDtstart(inputs);

  const seen = new Set<string>();
  const cases: CorpusCase[] = [];
  for (const [index, input] of inputs.entries()) {
    const built = buildCase(input, index + 1);
    if (seen.has(built.id)) {
      throw new Error(`duplicate corpus case id: ${built.id}`);
    }
    seen.add(built.id);
    cases.push(built);
  }
  cases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return cases;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortKeys(entry));
  if (typeof value === "object" && value !== null) {
    const source: Record<string, unknown> = { ...value };
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeys(source[key]);
    }
    return sorted;
  }
  return value;
}

export function serializeCorpus(cases: readonly CorpusCase[]): string {
  return (
    cases.map((entry) => JSON.stringify(sortKeys(entry))).join("\n") + "\n"
  );
}

export function serializeManifest(
  cases: readonly CorpusCase[],
  corpusText: string,
): string {
  const bySource = (source: CaseSource): number =>
    cases.filter((entry) => entry.source === source).length;
  const manifest = {
    anchorDate: ANCHOR_DATE,
    caseCount: cases.length,
    corpusSha256: createHash("sha256").update(corpusText).digest("hex"),
    edgeCaseCount: bySource("edge"),
    failOpenCaseCount: cases.filter((entry) => entry.outcome === "always")
      .length,
    failOpenProbeDate: FAIL_OPEN_PROBE_DATE,
    generatedBy:
      "packages/tasks-for-obsidian/scripts/build-recurrence-corpus.ts",
    generatedCaseCount: bySource("generated"),
    harvestedCaseCount: bySource("harvested"),
    modelEntryPoint: "tasknotes-types/v2 -> @tasknotes/model",
    occurrenceDateCount: cases.reduce(
      (total, entry) => total + entry.occurrences.length,
      0,
    ),
    windowDays: daysBetween(WINDOW_START, WINDOW_END) + 1,
    windowEnd: WINDOW_END,
    windowStart: WINDOW_START,
  };
  return JSON.stringify(manifest, null, 2) + "\n";
}

/**
 * Groups whose expansion is most sensitive to calendar arithmetic (month
 * lengths, nth-weekday, week starts, DTSTART resolution). `--tz-probe` prints
 * a digest over just these so the test can re-run the generator under several
 * `TZ` values cheaply and prove contract note 1 rather than assert it.
 */
const TZ_PROBE_GROUPS = new Set([
  "harvested",
  "dtstart",
  "wkst",
  "bymonthday",
  "byday-nth",
]);

export function tzProbeDigest(): string {
  const inputs = collectInputs().filter((input) =>
    TZ_PROBE_GROUPS.has(input.group),
  );
  const cases = inputs.map((input, index) => buildCase(input, index + 1));
  return createHash("sha256").update(serializeCorpus(cases)).digest("hex");
}

// ---------------------------------------------------------------------------
// Audit: prove the whole-window shortcut equals per-day `isDueByRRule`
// ---------------------------------------------------------------------------

type AuditReport = {
  readonly checkedPairs: number;
  readonly checkedCases: number;
};

function auditDaysFor(entry: CorpusCase): string[] {
  const days = new Set<string>([
    WINDOW_START,
    WINDOW_END,
    addDays(WINDOW_START, 1),
    addDays(WINDOW_END, -1),
  ]);
  // A 61-day band around the anchor, plus both sides of the first and last
  // occurrence — boundaries are where an inclusive/exclusive slip would show.
  for (let offset = -30; offset <= 30; offset += 1) {
    days.add(addDays(ANCHOR_DATE, offset));
  }
  const edges = [
    entry.firstOccurrence,
    entry.lastOccurrence,
    entry.occurrences[1] ?? null,
    entry.occurrences.at(-2) ?? null,
  ];
  for (const edge of edges) {
    if (edge === null) continue;
    for (const offset of [-1, 0, 1]) {
      const day = addDays(edge, offset);
      if (day >= WINDOW_START && day <= WINDOW_END) days.add(day);
    }
  }
  return [...days].sort();
}

export function auditCorpus(cases: readonly CorpusCase[]): AuditReport {
  const inputs = collectInputs();
  const byRecurrence = new Map<string, CaseInput>();
  for (const input of inputs) {
    byRecurrence.set(
      `${input.recurrence}|${input.scheduled ?? ""}|${input.dateCreated ?? ""}`,
      input,
    );
  }

  let checkedPairs = 0;
  let checkedCases = 0;
  for (const entry of cases) {
    // A rule with an empty whole-window expansion cannot have a non-empty
    // single-day expansion — `between(subinterval) ⊆ between(window) = ∅` — so
    // auditing it proves nothing. Skipping matters in practice: rrule keeps
    // scanning to its year bound before conceding an empty result, which makes
    // one such `between` call cost seconds.
    if (entry.outcome === "expanded" && entry.occurrenceCount === 0) continue;
    const input = byRecurrence.get(
      `${entry.recurrence}|${entry.scheduled ?? ""}|${entry.dateCreated ?? ""}`,
    );
    if (input === undefined) {
      throw new Error(`audit could not re-derive the input for ${entry.id}`);
    }
    const task = toTask(input);
    const occurrences = new Set(entry.occurrences);
    for (const day of auditDaysFor(entry)) {
      const actual = shouldShowRecurringTaskOnDate(task, utcDate(day));
      const expected = entry.outcome === "always" ? true : occurrences.has(day);
      if (actual !== expected) {
        throw new Error(
          `audit mismatch for ${entry.id} on ${day}: shouldShowRecurringTaskOnDate=${String(actual)}, corpus=${String(expected)}`,
        );
      }
      checkedPairs += 1;
    }
    checkedCases += 1;
  }
  return { checkedCases, checkedPairs };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const write = args.has("--write");
  const check = args.has("--check");
  const auditOnly = args.has("--audit");
  if (args.has("--tz-probe")) {
    console.log(tzProbeDigest());
    return;
  }
  if (!write && !check && !auditOnly) {
    console.error(
      "usage: bun scripts/build-recurrence-corpus.ts (--write | --check | --audit | --tz-probe)",
    );
    process.exitCode = 2;
    return;
  }

  const started = Bun.nanoseconds();
  const cases = buildCorpus();
  const corpusText = serializeCorpus(cases);
  const manifestText = serializeManifest(cases, corpusText);
  const elapsedMs = (Bun.nanoseconds() - started) / 1e6;

  const bytes = Buffer.byteLength(corpusText, "utf8");
  if (bytes > MAX_CORPUS_BYTES) {
    throw new Error(
      `corpus is ${String(bytes)} bytes, over the ${String(MAX_CORPUS_BYTES)}-byte budget`,
    );
  }

  if (auditOnly || write) {
    const report = auditCorpus(cases);
    console.log(
      `audit: ${String(report.checkedPairs)} (case, date) pairs across ${String(report.checkedCases)} cases agree with per-day shouldShowRecurringTaskOnDate`,
    );
  }

  if (write) {
    await Bun.write(CORPUS_PATH, corpusText);
    await Bun.write(MANIFEST_PATH, manifestText);
    console.log(
      `wrote ${String(cases.length)} cases (${String(bytes)} bytes, ${elapsedMs.toFixed(0)} ms) to packages/tasknotes-fixtures/recurrence/`,
    );
    return;
  }

  if (check) {
    const committedCorpus = await Bun.file(CORPUS_PATH).text();
    const committedManifest = await Bun.file(MANIFEST_PATH).text();
    if (committedCorpus !== corpusText || committedManifest !== manifestText) {
      console.error(
        "recurrence corpus is stale — run: bun scripts/build-recurrence-corpus.ts --write",
      );
      process.exitCode = 1;
      return;
    }
    console.log(`recurrence corpus is current (${String(cases.length)} cases)`);
  }
}

if (import.meta.main) {
  await main();
}
