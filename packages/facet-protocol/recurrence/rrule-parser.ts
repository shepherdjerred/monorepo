export type RRuleFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type ByDaySpec = {
  weekday: number;
  ordinal?: number | undefined;
};

export type ParsedRRule = {
  freq: RRuleFrequency;
  interval: number;
  byDay: ByDaySpec[];
  byMonthDay: number[];
  until?: Date | undefined;
  count?: number | undefined;
  dtstart?: Date | undefined;
};

const WEEKDAY_MAP: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

export function parseCompactDate(
  raw: string,
  endOfDay: boolean,
): Date | undefined {
  const dateTimeMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/i.exec(
    raw,
  );
  if (dateTimeMatch !== null) {
    const [, y, m, d, hh, mm, ss] = dateTimeMatch;
    return new Date(
      Date.UTC(
        Number(y),
        Number(m) - 1,
        Number(d),
        Number(hh),
        Number(mm),
        Number(ss),
      ),
    );
  }

  const dateOnlyMatch = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(raw);
  if (dateOnlyMatch !== null) {
    const [, y, m, d] = dateOnlyMatch;
    return endOfDay
      ? new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 23, 59, 59, 999))
      : new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0));
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? undefined : fallback;
}

function parseByDayItem(rawItem: string): ByDaySpec | null {
  const match = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(rawItem.trim());
  if (match === null) {
    return null;
  }
  const code = (match[2] ?? "").toUpperCase();
  const weekday = WEEKDAY_MAP[code];
  if (weekday === undefined) {
    return null;
  }
  const ordRaw = match[1];
  const ordinal =
    ordRaw === undefined || ordRaw === ""
      ? undefined
      : Number.parseInt(ordRaw, 10);
  return ordinal === undefined || ordinal === 0
    ? { weekday }
    : { weekday, ordinal };
}

function parseByDayList(raw: string): ByDaySpec[] {
  const specs: ByDaySpec[] = [];
  for (const part of raw.split(",")) {
    const spec = parseByDayItem(part);
    if (spec !== null) {
      specs.push(spec);
    }
  }
  return specs;
}

function parseByMonthDayList(raw: string): number[] {
  const days: number[] = [];
  for (const part of raw.split(",")) {
    const num = Number.parseInt(part.trim(), 10);
    if (num !== 0 && num >= -31 && num <= 31 && !Number.isNaN(num)) {
      days.push(num);
    }
  }
  return days;
}

function parseFrequency(raw: string): RRuleFrequency | undefined {
  const upper = raw.toUpperCase();
  return upper === "DAILY" ||
    upper === "WEEKLY" ||
    upper === "MONTHLY" ||
    upper === "YEARLY"
    ? upper
    : undefined;
}

type MutableRuleState = {
  freq?: RRuleFrequency | undefined;
  interval: number;
  byDay: ByDaySpec[];
  byMonthDay: number[];
  until?: Date | undefined;
  count?: number | undefined;
  dtstart?: Date | undefined;
};

function applyKeyValueToken(
  state: MutableRuleState,
  key: string,
  val: string,
): void {
  switch (key.toUpperCase()) {
    case "FREQ": {
      state.freq = parseFrequency(val);
      break;
    }
    case "INTERVAL": {
      const parsed = Number.parseInt(val, 10);
      if (parsed > 0 && !Number.isNaN(parsed)) {
        state.interval = parsed;
      }
      break;
    }
    case "BYDAY": {
      state.byDay = parseByDayList(val);
      break;
    }
    case "BYMONTHDAY": {
      state.byMonthDay = parseByMonthDayList(val);
      break;
    }
    case "UNTIL": {
      state.until = parseCompactDate(val, true);
      break;
    }
    case "COUNT": {
      const parsed = Number.parseInt(val, 10);
      if (!Number.isNaN(parsed)) {
        state.count = parsed;
      }
      break;
    }
    default: {
      break;
    }
  }
}

export function parseRRule(rawRule: string): ParsedRRule | null {
  const state: MutableRuleState = {
    interval: 1,
    byDay: [],
    byMonthDay: [],
  };

  for (const rawPart of rawRule.split(/[;\r\n]+/)) {
    const trimmed = rawPart.trim();
    if (trimmed === "") {
      continue;
    }
    const stripped = trimmed.replace(/^RRULE:/i, "");
    if (/^DTSTART:/i.test(stripped)) {
      state.dtstart = parseCompactDate(stripped.slice(8), false);
      continue;
    }
    const colonIdx = stripped.indexOf(":");
    const eqIdx = stripped.indexOf("=");
    if (colonIdx !== -1 && /^VALUE=DATE/i.test(stripped)) {
      state.dtstart = parseCompactDate(stripped.slice(colonIdx + 1), false);
      continue;
    }
    if (eqIdx !== -1) {
      applyKeyValueToken(
        state,
        stripped.slice(0, eqIdx).trim(),
        stripped.slice(eqIdx + 1).trim(),
      );
    }
  }

  return state.freq === undefined
    ? null
    : {
        freq: state.freq,
        interval: state.interval,
        byDay: state.byDay,
        byMonthDay: state.byMonthDay,
        until: state.until,
        count: state.count,
        dtstart: state.dtstart,
      };
}
