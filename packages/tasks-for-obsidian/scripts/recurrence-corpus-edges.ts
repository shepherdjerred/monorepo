/**
 * Recurrence corpus — HARVESTED, DTSTART-resolution, and MALFORMED cases.
 *
 * The highest-value rows: real rule strings taken from the repository, the
 * ways the model resolves (or fails to resolve) a DTSTART, and hostile inputs
 * that pin down fail-open versus fail-closed behaviour.
 *
 * Split out of `build-recurrence-corpus.ts` to stay inside the repository's
 * 500-line limit.
 */
import { makeCase, type CaseInput } from "./recurrence-corpus-case.ts";

/**
 * Every distinct `recurrence` string that exists in the repository today
 * (fixtures, unit tests, contract tests, seed vaults, server vault corpora),
 * harvested with
 * `rg -o '(DTSTART:[0-9TZ]+;)?FREQ=[A-Za-z0-9;=,+-]+' -g '!node_modules'`.
 * Deliberately a frozen literal rather than a filesystem scan: a scan would
 * make the corpus churn every time an unrelated test grew a rule string.
 */
const HARVESTED_RULES: readonly {
  readonly recurrence: string;
  readonly where: string;
}[] = [
  {
    recurrence: "FREQ=DAILY",
    where:
      "e2e/fixtures/seed-vault, contract-tests, server conformance + idempotency + v2-routes tests, offline-scenarios, harness, commands tests",
  },
  {
    recurrence: "FREQ=WEEKLY;BYDAY=MO",
    where:
      "tasknotes-server __tests__/fixtures/vault-corpus/TaskNotes/recurring.md, src/domain/recurrence.test.ts",
  },
  {
    recurrence: "FREQ=MONTHLY",
    where: "src/domain/recurrence.test.ts",
  },
  {
    recurrence: "DTSTART:20260220;FREQ=MONTHLY;BYMONTHDAY=20",
    where: "src/domain/recurrence.test.ts",
  },
  {
    recurrence: "DTSTART:20260301;FREQ=MONTHLY;BYMONTHDAY=1",
    where: "src/domain/recurrence.test.ts",
  },
  {
    recurrence: "DTSTART:20260508;FREQ=WEEKLY",
    where: "src/domain/recurrence.test.ts",
  },
];

export function harvestedCases(): CaseInput[] {
  return HARVESTED_RULES.map((rule) =>
    makeCase({
      group: "harvested",
      recurrence: rule.recurrence,
      source: "harvested",
      note: `real rule string in the repo: ${rule.where}`,
    }),
  );
}
/** How the model resolves DTSTART, and what happens when it cannot. */
function dtstartCases(): CaseInput[] {
  return [
    makeCase({
      group: "dtstart",
      recurrence: "DTSTART:20210131;FREQ=MONTHLY;BYMONTHDAY=31",
      note: "DTSTART embedded in the rule wins over scheduled",
      scheduled: "2026-06-15",
    }),
    makeCase({
      group: "dtstart",
      recurrence: "DTSTART:20260105T093000Z;FREQ=WEEKLY;BYDAY=MO",
      note: "DTSTART with a time component",
    }),
    makeCase({
      group: "dtstart",
      recurrence: "DTSTART:20240229;FREQ=YEARLY",
      note: "YEARLY anchored on a leap day",
    }),
    makeCase({
      group: "dtstart",
      recurrence: "DTSTART:20301230;FREQ=DAILY",
      note: "DTSTART at the very end of the window",
    }),
    makeCase({
      group: "dtstart",
      recurrence: "DTSTART:20210101;FREQ=DAILY;INTERVAL=400",
      note: "interval longer than a year from the window start",
    }),
    makeCase({
      group: "dtstart",
      recurrence: "FREQ=WEEKLY;BYDAY=MO",
      scheduled: null,
      dateCreated: "2026-01-07",
      note: "dateCreated is the DTSTART fallback when scheduled is absent",
    }),
    makeCase({
      group: "dtstart",
      recurrence: "FREQ=WEEKLY;BYDAY=MO",
      scheduled: "2026-01-05",
      dateCreated: "2021-06-01",
      note: "scheduled wins over dateCreated",
    }),
    makeCase({
      group: "dtstart",
      recurrence: "FREQ=DAILY",
      scheduled: null,
      dateCreated: null,
      note: "FAIL CLOSED: no DTSTART source at all makes createRRule return null and isDueByRRule return false on every date",
    }),
    makeCase({
      group: "dtstart",
      recurrence: "FREQ=WEEKLY;BYDAY=MO",
      scheduled: "2026-01-05T09:30:00Z",
      note: "scheduled carries a time component; only the date part is used",
    }),
    makeCase({
      group: "dtstart",
      recurrence: "FREQ=MONTHLY",
      scheduled: "2021-01-31",
      note: "MONTHLY anchored on the 31st skips short months entirely",
    }),
    makeCase({
      group: "dtstart",
      recurrence: "FREQ=YEARLY",
      scheduled: "2024-02-29",
      note: "YEARLY anchored on a leap day via scheduled",
    }),
    makeCase({
      group: "dtstart",
      recurrence: "FREQ=DAILY;INTERVAL=2",
      scheduled: "2021-01-01",
      note: "phase parity across the whole window from the first day",
    }),
    makeCase({
      group: "dtstart",
      recurrence: "FREQ=DAILY;INTERVAL=2",
      scheduled: "2021-01-02",
      note: "the opposite phase of the preceding case",
    }),
  ];
}

/**
 * Rule strings that make rrule.js 2.8.1 LOOP FOREVER instead of throwing or
 * returning nothing — observed, not theorised: a single expansion of either
 * string never returns. They are therefore deliberately ABSENT from the corpus
 * (generating one would hang CI), and `assertNoNonTerminatingRules` keeps them
 * out if someone adds them back later.
 *
 * Both reduce to a non-positive iteration step (`-1`, and `abc` via
 * `Number.parseInt` producing `NaN`), which never advances the iterator far
 * enough to trip rrule's year bound. Note that `INTERVAL=0` is NOT in this
 * class — it returns an empty expansion immediately — so the boundary is
 * genuinely "negative or NaN", not "not positive".
 *
 * CONSEQUENCE FOR THE RUST PORT: an unbounded loop driven by a value parsed
 * out of user text is a hang, not a wrong answer. The engine must reject a
 * non-positive interval at parse time (or bound its own iteration) rather than
 * reproducing rrule's behaviour here.
 */
const NON_TERMINATING_RULES = new Set([
  "FREQ=DAILY;INTERVAL=-1",
  "FREQ=DAILY;INTERVAL=abc",
]);

export function assertNoNonTerminatingRules(
  inputs: readonly CaseInput[],
): void {
  for (const input of inputs) {
    if (NON_TERMINATING_RULES.has(input.recurrence)) {
      throw new Error(
        `"${input.recurrence}" makes rrule.js loop forever and cannot be part of the corpus`,
      );
    }
  }
}

/**
 * Malformed, contradictory, and hostile inputs. These are the highest-value
 * rows in the corpus: they pin down which shapes fail OPEN (`outcome: always`)
 * and which merely produce no occurrences.
 */
function malformedCases(): CaseInput[] {
  const raw: readonly { recurrence: string; note: string }[] = [
    {
      recurrence: "",
      note: "empty string short-circuits to true before any parsing",
    },
    {
      recurrence: "   ",
      note: "whitespace-only is truthy so it reaches the parser, which yields an EMPTY option set — and rrule defaults that to FREQ=YEARLY rather than failing",
    },
    { recurrence: "garbage", note: "no key=value pairs at all" },
    { recurrence: "FREQ=", note: "FREQ present but empty" },
    { recurrence: "FREQ=NONSENSE", note: "unknown FREQ value" },
    { recurrence: "freq=daily", note: "lowercase keys" },
    {
      recurrence: "RRULE:FREQ=DAILY",
      note: "content-line prefix that rrule tolerates",
    },
    {
      recurrence: "FREQ=DAILY;",
      note: "a TRAILING separator fails to parse; the model only strips a LEADING one",
    },
    { recurrence: "FREQ=DAILY;;INTERVAL=2", note: "doubled separator" },
    {
      recurrence: ";FREQ=DAILY",
      note: "a leading separator is stripped by the model and parses fine",
    },
    {
      recurrence: "FREQ=DAILY;INTERVAL=0",
      note: "interval zero yields nothing",
    },
    { recurrence: "FREQ=DAILY;COUNT=0", note: "zero count yields nothing" },
    {
      recurrence: "FREQ=DAILY;COUNT=-5",
      note: "a negative COUNT is IGNORED, leaving an unbounded rule",
    },
    {
      recurrence: "FREQ=DAILY;COUNT=abc",
      note: "a NaN COUNT collapses to a single occurrence",
    },
    {
      recurrence: "FREQ=DAILY;UNTIL=2027-01-01",
      note: "UNTIL in ISO form instead of the RRULE basic form",
    },
    {
      recurrence: "FREQ=DAILY;UNTIL=20270101T000000",
      note: "UNTIL with a time but no Z still parses",
    },
    { recurrence: "FREQ=DAILY;UNTIL=notadate", note: "UNTIL is not a date" },
    {
      recurrence: "FREQ=DAILY;UNTIL=20260231",
      note: "UNTIL is 31 February, which silently ROLLS OVER to 3 March instead of being rejected",
    },
    { recurrence: "FREQ=WEEKLY;BYDAY=XX", note: "unknown weekday code" },
    { recurrence: "FREQ=WEEKLY;BYDAY=", note: "empty BYDAY" },
    {
      recurrence: "FREQ=WEEKLY;BYDAY=MO,,FR",
      note: "empty element inside BYDAY",
    },
    { recurrence: "FREQ=MONTHLY;BYMONTHDAY=32", note: "day 32 does not exist" },
    { recurrence: "FREQ=MONTHLY;BYMONTHDAY=0", note: "day 0 does not exist" },
    { recurrence: "FREQ=YEARLY;BYMONTH=13", note: "month 13 does not exist" },
    {
      recurrence: "FREQ=YEARLY;BYMONTH=0",
      note: "month 0 is silently IGNORED and the rule still fires, unlike month 13 which yields nothing",
    },
    {
      recurrence: "FREQ=DAILY;BYSETPOS=1",
      note: "BYSETPOS with nothing to select from",
    },
    {
      recurrence: "FREQ=DAILY;BYDAY=MO;BYMONTHDAY=15",
      note: "contradictory refiners: a Monday that is also the 15th",
    },
    {
      recurrence: "FREQ=WEEKLY;BYMONTHDAY=15",
      note: "BYMONTHDAY is not valid for WEEKLY per RFC 5545",
    },
    { recurrence: "FREQ=DAILY;UNKNOWNPART=7", note: "unknown rule part" },
    {
      recurrence: "FREQ=DAILY;WKST=XX",
      note: "an unknown WKST is silently ignored rather than rejected",
    },
    {
      recurrence: "DTSTART:notadate;FREQ=DAILY",
      note: "the DTSTART regex misses, so resolution silently falls back to `scheduled` instead of failing",
    },
    {
      recurrence: "DTSTART:20260230;FREQ=DAILY",
      note: "embedded DTSTART is 30 February, which silently rolls over to 2 March",
    },
    {
      recurrence: "DTSTART:20260105",
      note: "DTSTART with no rule body: the model strips DTSTART, leaving an empty string that rrule defaults to FREQ=YEARLY",
    },
    { recurrence: "FREQ", note: "a bare token" },
    { recurrence: "=DAILY", note: "value with no key" },
  ];
  const cases = raw.map((entry) =>
    makeCase({
      group: "malformed",
      recurrence: entry.recurrence,
      source: "edge",
      note: entry.note,
    }),
  );
  // Same hostile strings, but with no DTSTART source: contract note 4 says the
  // missing-DTSTART check runs BEFORE parsing, so these are fail-CLOSED even
  // though the identical rule string fails OPEN above.
  for (const recurrence of ["", "garbage", "FREQ=NONSENSE", "FREQ=DAILY"]) {
    cases.push(
      makeCase({
        group: "malformed",
        recurrence,
        scheduled: null,
        dateCreated: null,
        source: "edge",
        note: "no DTSTART source: the missing-DTSTART check runs before parsing",
      }),
    );
  }
  return cases;
}

/** Harvested, DTSTART-resolution, and malformed cases, in a stable order. */
export function edgeCases(): CaseInput[] {
  return [...dtstartCases(), ...malformedCases()];
}
