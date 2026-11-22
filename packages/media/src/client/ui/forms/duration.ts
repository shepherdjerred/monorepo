/**
 * A length of time as a person enters it, an amount and a unit, and as a
 * contract stores it, a number of seconds.
 *
 * Both directions are exact. A stored value is shown in the largest offered
 * unit that states it as a whole number, so nothing is rounded on the way
 * in. What is typed is multiplied out in decimal, not in floating point, so
 * 1.1 hours is 3960 seconds and an amount that is not a whole number of
 * seconds is refused instead of being rounded to one.
 */

const UNIT_SECONDS = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86_400,
} as const;

export type DurationUnit = keyof typeof UNIT_SECONDS;

const LARGEST_FIRST: readonly DurationUnit[] = [
  "days",
  "hours",
  "minutes",
  "seconds",
];

/**
 * Units to offer, smallest first. Seconds is always among them, so every
 * value a contract can hold has a unit that states it exactly.
 */
type OfferedUnits = readonly ["seconds", ...DurationUnit[]];

export const EVERY_DURATION_UNIT = [
  "seconds",
  "minutes",
  "hours",
  "days",
] as const satisfies OfferedUnits;

export type DurationRules = {
  units: OfferedUnits;
  /** The unit an empty field, or a stored zero, starts in. */
  startUnit: DurationUnit;
  /** The shortest time allowed, in seconds. */
  min: number;
  /** The longest time allowed, in seconds. */
  max?: number;
  /** Set when the contract takes a fraction of a second. Most take whole seconds. */
  fractional?: boolean;
};

export type ParsedDuration =
  /** `null` is an empty field: no time at all. */
  { ok: true; seconds: number | null } | { ok: false; message: string };

/** The name of the control that holds a duration field's unit. */
export function durationUnitName(name: string): string {
  return `${name}Unit`;
}

/** What a duration field's unit control holds, as a unit. */
export function durationUnit(value: string): DurationUnit {
  const unit = LARGEST_FIRST.find((known) => known === value);
  if (unit === undefined) throw new TypeError(`Unknown duration unit ${value}`);
  return unit;
}

/** The largest of `units` that states `seconds` as a whole number. */
function largestExactUnit(seconds: number, units: OfferedUnits): DurationUnit {
  const unit = LARGEST_FIRST.find(
    (candidate) =>
      units.includes(candidate) && seconds % UNIT_SECONDS[candidate] === 0,
  );
  // A fraction of a second is a whole number of no unit; seconds states it.
  return unit ?? "seconds";
}

/** What the two controls start with for a stored number of seconds. */
export function durationInput(
  seconds: number | null,
  rules: Pick<DurationRules, "units" | "startUnit">,
): { amount: string; unit: DurationUnit } {
  if (seconds === null) return { amount: "", unit: rules.startUnit };
  if (seconds === 0) return { amount: "0", unit: rules.startUnit };
  const unit = largestExactUnit(seconds, rules.units);
  return { amount: String(seconds / UNIT_SECONDS[unit]), unit };
}

/** A stored number of seconds in words: "90 seconds", "3 days", "1 hour". */
export function formatDuration(
  seconds: number,
  units: OfferedUnits = EVERY_DURATION_UNIT,
): string {
  // Every unit states zero; the smallest is the plainest way to say it.
  const unit = seconds === 0 ? "seconds" : largestExactUnit(seconds, units);
  const amount = seconds / UNIT_SECONDS[unit];
  return `${String(amount)} ${amount === 1 ? unit.slice(0, -1) : unit}`;
}

/** Seconds as `whole + remainder / 10 ** places`, with nothing lost. */
type ExactSeconds = {
  negative: boolean;
  whole: bigint;
  remainder: bigint;
  places: number;
};

// What a number input holds: digits, an optional fraction, an optional
// exponent.
const DECIMAL =
  /^(?<sign>-?)(?<integer>\d*)(?:\.(?<fraction>\d*))?(?:e(?<exponent>[+-]?\d+))?$/iu;
/** Past this a number is not a length of time anyone means. */
const LARGEST_EXPONENT = 1000;

function exactSeconds(text: string, unit: DurationUnit): ExactSeconds | null {
  const groups = DECIMAL.exec(text)?.groups;
  if (groups === undefined) return null;
  const digits = `${groups["integer"] ?? ""}${groups["fraction"] ?? ""}`;
  const exponent = Number(groups["exponent"] ?? "0");
  if (digits === "" || Math.abs(exponent) > LARGEST_EXPONENT) return null;
  // The amount is `digits / 10 ** shift`.
  const shift = (groups["fraction"] ?? "").length - exponent;
  const places = Math.max(0, shift);
  const numerator =
    BigInt(digits) *
    BigInt(UNIT_SECONDS[unit]) *
    10n ** BigInt(Math.max(0, -shift));
  const divisor = 10n ** BigInt(places);
  return {
    negative: groups["sign"] === "-" && numerator > 0n,
    whole: numerator / divisor,
    remainder: numerator % divisor,
    places,
  };
}

function decimalText(exact: ExactSeconds): string {
  const fraction = exact.remainder
    .toString()
    .padStart(exact.places, "0")
    .replace(/0+$/u, "");
  return `${exact.negative ? "-" : ""}${exact.whole.toString()}${
    fraction === "" ? "" : `.${fraction}`
  }`;
}

/** The limit a time is past, as the sentence that says so. */
function outOfRange(seconds: number, rules: DurationRules): string | null {
  if (seconds < rules.min) {
    return `Enter ${formatDuration(rules.min, rules.units)} or more.`;
  }
  if (rules.max !== undefined && seconds > rules.max) {
    return `Enter ${formatDuration(rules.max, rules.units)} or less.`;
  }
  // Past this a number no longer counts single seconds.
  return seconds > Number.MAX_SAFE_INTEGER ? "Enter a shorter time." : null;
}

/**
 * What an amount and a unit come to in seconds, or the sentence that says
 * how to fix them. An empty amount is no time at all, not a mistake: a
 * field that needs one says so itself.
 */
export function parseDuration(
  amount: string,
  unit: DurationUnit,
  rules: DurationRules,
): ParsedDuration {
  const text = amount.trim();
  if (text === "") return { ok: true, seconds: null };
  const exact = exactSeconds(text, unit);
  if (exact === null) return { ok: false, message: "Enter a number." };
  if (exact.remainder !== 0n && rules.fractional !== true) {
    return {
      ok: false,
      message:
        unit === "seconds"
          ? "Enter a whole number of seconds."
          : `Enter a whole number of seconds. ${text} ${unit} is ${decimalText(exact)} seconds.`,
    };
  }
  const seconds = Number(decimalText(exact));
  const message = outOfRange(seconds, rules);
  return message === null ? { ok: true, seconds } : { ok: false, message };
}

/** The duration field called `name`, as a submitted form holds it. */
export function readDuration(
  form: FormData,
  name: string,
  rules: DurationRules,
): ParsedDuration {
  const amount = form.get(name);
  const unit = form.get(durationUnitName(name));
  if (typeof amount !== "string" || typeof unit !== "string") {
    throw new TypeError(`Missing ${name}`);
  }
  return parseDuration(amount, durationUnit(unit), rules);
}
