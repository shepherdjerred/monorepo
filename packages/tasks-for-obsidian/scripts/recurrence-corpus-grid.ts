/**
 * Recurrence corpus — the GENERATED grid.
 *
 * `FREQ x INTERVAL x BYDAY x BYMONTHDAY x BYSETPOS x BYMONTH x BYYEARDAY x
 * BYWEEKNO x WKST x COUNT/UNTIL`, plus sub-daily frequencies. Every rule here
 * is well-formed; the hostile inputs live in `recurrence-corpus-edges.ts`.
 *
 * Split out of `build-recurrence-corpus.ts` to stay inside the repository's
 * 500-line limit.
 */
import {
  FREQUENCIES,
  INTERVALS,
  makeCase,
  withInterval,
  type CaseInput,
} from "./recurrence-corpus-case.ts";

function freqIntervalCases(): CaseInput[] {
  const cases: CaseInput[] = [];
  for (const freq of FREQUENCIES) {
    for (const interval of INTERVALS) {
      cases.push(
        makeCase({
          group: "freq-interval",
          recurrence: withInterval(`FREQ=${freq}`, interval),
        }),
      );
    }
  }
  for (const interval of [7, 12, 100]) {
    cases.push(
      makeCase({
        group: "freq-interval",
        recurrence: withInterval("FREQ=DAILY", interval),
        note: "large interval",
      }),
      makeCase({
        group: "freq-interval",
        recurrence: withInterval("FREQ=MONTHLY", interval),
        note: "large interval",
      }),
    );
  }
  return cases;
}

function bydayCases(): CaseInput[] {
  const single = ["MO", "TU", "FR", "SA", "SU"];
  const multi = ["MO,WE,FR", "SA,SU", "MO,TU,WE,TH,FR", "TU,TH"];
  const nth = ["1MO", "2MO", "3WE", "4FR", "5MO", "-1FR", "-2TU", "-1SU"];

  const cases: CaseInput[] = [];
  for (const freq of FREQUENCIES) {
    for (const byday of single) {
      for (const interval of [1, 2]) {
        cases.push(
          makeCase({
            group: "byday-single",
            recurrence: withInterval(`FREQ=${freq};BYDAY=${byday}`, interval),
          }),
        );
      }
    }
    for (const byday of multi) {
      cases.push(
        makeCase({
          group: "byday-multi",
          recurrence: `FREQ=${freq};BYDAY=${byday}`,
        }),
      );
    }
  }
  for (const freq of ["MONTHLY", "YEARLY"] as const) {
    for (const byday of nth) {
      cases.push(
        makeCase({
          group: "byday-nth",
          recurrence: `FREQ=${freq};BYDAY=${byday}`,
          note:
            byday === "5MO"
              ? "5th weekday only exists in some months"
              : undefined,
        }),
      );
    }
  }
  // `BYDAY=5MO` at INTERVAL=2 exercises the skip-a-period-then-skip-a-month path.
  cases.push(
    makeCase({
      group: "byday-nth",
      recurrence: "FREQ=MONTHLY;INTERVAL=2;BYDAY=5MO",
    }),
    makeCase({
      group: "byday-nth",
      recurrence: "FREQ=MONTHLY;BYDAY=1MO,-1FR",
      note: "first and last named weekday in one rule",
    }),
  );
  return cases;
}

function bymonthdayCases(): CaseInput[] {
  const monthdays = [
    "1",
    "15",
    "20",
    "28",
    "29",
    "30",
    "31",
    "-1",
    "-2",
    "-7",
    "1,15",
    "15,-1",
    "29,30,31",
  ];
  const cases: CaseInput[] = [];
  for (const freq of ["MONTHLY", "YEARLY"] as const) {
    for (const monthday of monthdays) {
      cases.push(
        makeCase({
          group: "bymonthday",
          recurrence: `FREQ=${freq};BYMONTHDAY=${monthday}`,
          note:
            freq === "YEARLY" && monthday === "20"
              ? "known-dangerous: rrule.js expands YEARLY;BYMONTHDAY into EVERY month, not just DTSTART's month, so this behaves monthly"
              : undefined,
        }),
      );
    }
  }
  for (const interval of [2, 3]) {
    cases.push(
      makeCase({
        group: "bymonthday",
        recurrence: withInterval("FREQ=MONTHLY;BYMONTHDAY=31", interval),
        note: "short months are skipped, which shifts the interval phase",
      }),
      makeCase({
        group: "bymonthday",
        recurrence: withInterval("FREQ=MONTHLY;BYMONTHDAY=-1", interval),
      }),
    );
  }
  return cases;
}

function bysetposCases(): CaseInput[] {
  const bydays = ["MO,WE,FR", "MO,TU,WE,TH,FR", "SA,SU", "MO"];
  const setpos = ["1", "2", "-1", "-2", "1,-1"];
  const cases: CaseInput[] = [];
  for (const freq of ["WEEKLY", "MONTHLY", "YEARLY"] as const) {
    for (const byday of bydays) {
      for (const pos of setpos) {
        cases.push(
          makeCase({
            group: "bysetpos",
            recurrence: `FREQ=${freq};BYDAY=${byday};BYSETPOS=${pos}`,
          }),
        );
      }
    }
  }
  cases.push(
    makeCase({
      group: "bysetpos",
      recurrence: "FREQ=MONTHLY;BYMONTHDAY=1,15,-1;BYSETPOS=-1",
      note: "BYSETPOS over BYMONTHDAY rather than BYDAY",
    }),
    makeCase({
      group: "bysetpos",
      recurrence: "FREQ=DAILY;BYDAY=MO,WE;BYSETPOS=1",
      note: "BYSETPOS on a DAILY rule has a single-element set to pick from",
    }),
  );
  return cases;
}

function bymonthCases(): CaseInput[] {
  const months = ["1", "2", "12", "1,7", "3,6,9,12"];
  const refiners = ["", ";BYMONTHDAY=15", ";BYMONTHDAY=-1", ";BYDAY=1MO"];
  const cases: CaseInput[] = [];
  for (const month of months) {
    for (const refiner of refiners) {
      cases.push(
        makeCase({
          group: "bymonth",
          recurrence: `FREQ=YEARLY;BYMONTH=${month}${refiner}`,
        }),
      );
    }
  }
  cases.push(
    makeCase({
      group: "bymonth",
      recurrence: "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29",
      note: "leap day only: 2024 and 2028 inside the window",
    }),
    makeCase({
      group: "bymonth",
      recurrence: "FREQ=MONTHLY;BYMONTH=1,7;BYMONTHDAY=1",
      note: "BYMONTH as a filter on a MONTHLY rule",
    }),
  );
  return cases;
}

function byyeardayAndByweeknoCases(): CaseInput[] {
  const cases: CaseInput[] = [];
  for (const yearday of ["1", "100", "-1", "366", "1,-1"]) {
    cases.push(
      makeCase({
        group: "byyearday",
        recurrence: `FREQ=YEARLY;BYYEARDAY=${yearday}`,
        note: yearday === "366" ? "only exists in leap years" : undefined,
      }),
    );
  }
  for (const weekno of ["1", "20", "53"]) {
    cases.push(
      makeCase({
        group: "byweekno",
        recurrence: `FREQ=YEARLY;BYWEEKNO=${weekno}`,
      }),
      makeCase({
        group: "byweekno",
        recurrence: `FREQ=YEARLY;BYWEEKNO=${weekno};BYDAY=MO`,
        note:
          weekno === "53" ? "ISO week 53 only exists in long years" : undefined,
      }),
    );
  }
  return cases;
}

/** WKST silently changes which weeks a `WEEKLY;INTERVAL>1` rule lands in. */
function wkstCases(): CaseInput[] {
  const cases: CaseInput[] = [];
  for (const wkst of ["MO", "SU", "TU", "SA"]) {
    cases.push(
      makeCase({
        group: "wkst",
        recurrence: `FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=${wkst}`,
        note: "WKST decides whether SU and MO fall in the same iteration week",
      }),
      makeCase({
        group: "wkst",
        recurrence: `FREQ=YEARLY;BYWEEKNO=1;BYDAY=MO;WKST=${wkst}`,
      }),
    );
  }
  return cases;
}

function terminationCases(): CaseInput[] {
  const bases = [
    "FREQ=DAILY",
    "FREQ=DAILY;INTERVAL=3",
    "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    "FREQ=MONTHLY;BYMONTHDAY=-1",
    "FREQ=MONTHLY;BYDAY=2MO",
    "FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=15",
  ];
  const terminators: readonly { suffix: string; note?: string }[] = [
    { suffix: "COUNT=1", note: "single occurrence" },
    { suffix: "COUNT=5" },
    { suffix: "COUNT=100" },
    { suffix: "UNTIL=20260701", note: "date-only UNTIL, no Z" },
    { suffix: "UNTIL=20260701T000000Z", note: "UTC UNTIL with a Z" },
    { suffix: "UNTIL=20260701T235959Z" },
    {
      suffix: "UNTIL=20211231",
      note: "UNTIL is before DTSTART: zero occurrences, and getFiniteRecurringInstanceCount returns null rather than 0",
    },
    {
      suffix: "COUNT=5;UNTIL=20301231",
      note: "conflicting COUNT and UNTIL in one rule",
    },
  ];
  const cases: CaseInput[] = [];
  for (const base of bases) {
    for (const terminator of terminators) {
      cases.push(
        makeCase({
          group: "termination",
          recurrence: `${base};${terminator.suffix}`,
          note: terminator.note,
        }),
      );
    }
  }
  return cases;
}

/** Sub-daily frequencies collapse to "every day" once dates are the unit. */
function subDailyCases(): CaseInput[] {
  return [
    makeCase({
      group: "sub-daily",
      recurrence: "FREQ=HOURLY",
      note: "24 raw occurrences per day collapse to one date",
    }),
    makeCase({ group: "sub-daily", recurrence: "FREQ=HOURLY;INTERVAL=6" }),
    makeCase({ group: "sub-daily", recurrence: "FREQ=HOURLY;INTERVAL=36" }),
    makeCase({
      group: "sub-daily",
      recurrence: "FREQ=MINUTELY;INTERVAL=90;COUNT=200",
      note: "COUNT is required: an unbounded MINUTELY rule expands to millions of instances across the window",
    }),
    makeCase({
      group: "sub-daily",
      recurrence: "FREQ=SECONDLY;INTERVAL=3600;COUNT=100",
    }),
    makeCase({
      group: "sub-daily",
      recurrence: "FREQ=DAILY;BYHOUR=9,17",
      note: "BYHOUR multiplies raw occurrences but not dates",
    }),
    makeCase({
      group: "sub-daily",
      recurrence: "FREQ=HOURLY;BYHOUR=9;BYMINUTE=30",
    }),
  ];
}

/** Every well-formed grid case, in a stable order. */
export function gridCases(): CaseInput[] {
  return [
    ...freqIntervalCases(),
    ...bydayCases(),
    ...bymonthdayCases(),
    ...bysetposCases(),
    ...bymonthCases(),
    ...byyeardayAndByweeknoCases(),
    ...wkstCases(),
    ...terminationCases(),
    ...subDailyCases(),
  ];
}
