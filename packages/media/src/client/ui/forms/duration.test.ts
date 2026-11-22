import { test, expect } from "vitest";
import {
  durationInput,
  durationUnit,
  EVERY_DURATION_UNIT,
  formatDuration,
  parseDuration,
  readDuration,
  type DurationRules,
  type DurationUnit,
} from "./duration.ts";

const whole: DurationRules = {
  units: EVERY_DURATION_UNIT,
  startUnit: "days",
  min: 1,
};
const wait: DurationRules = {
  units: ["seconds", "minutes"],
  startUnit: "seconds",
  min: 1,
  max: 3600,
};
const perGiB: DurationRules = {
  units: EVERY_DURATION_UNIT,
  startUnit: "hours",
  min: 0.001,
  fractional: true,
};

test("a stored value is shown in the largest unit that states it as a whole number", () => {
  const shown: [number, string, DurationUnit][] = [
    [1, "1", "seconds"],
    [59, "59", "seconds"],
    [60, "1", "minutes"],
    [90, "90", "seconds"],
    [5400, "90", "minutes"],
    [3600, "1", "hours"],
    [86_400, "1", "days"],
    [129_600, "36", "hours"],
    [259_200, "3", "days"],
    [1_209_600, "14", "days"],
    [86_401, "86401", "seconds"],
    [Number.MAX_SAFE_INTEGER, "9007199254740991", "seconds"],
  ];
  for (const [seconds, amount, unit] of shown) {
    expect(durationInput(seconds, whole), String(seconds)).toEqual({
      amount,
      unit,
    });
  }
});

test("only the units a field offers are used to show its value", () => {
  expect(durationInput(3600, wait)).toEqual({ amount: "60", unit: "minutes" });
  expect(durationInput(86_400, wait)).toEqual({
    amount: "1440",
    unit: "minutes",
  });
  expect(durationInput(45, wait)).toEqual({ amount: "45", unit: "seconds" });
});

test("nothing stored and a stored zero start in the field's own unit", () => {
  expect(durationInput(null, whole)).toEqual({ amount: "", unit: "days" });
  expect(durationInput(0, whole)).toEqual({ amount: "0", unit: "days" });
  expect(durationInput(null, perGiB)).toEqual({ amount: "", unit: "hours" });
});

test("a stored fraction of a second is shown as it is, in seconds", () => {
  expect(durationInput(0.5, perGiB)).toEqual({
    amount: "0.5",
    unit: "seconds",
  });
  expect(durationInput(90.25, perGiB)).toEqual({
    amount: "90.25",
    unit: "seconds",
  });
});

test("every stored value comes back as the same seconds", () => {
  const stored = [
    1,
    7,
    59,
    60,
    61,
    90,
    3599,
    3600,
    5400,
    86_399,
    86_400,
    129_600,
    259_200,
    604_800,
    1_209_600,
    31_536_000,
    31_536_001,
    2 ** 40,
    Number.MAX_SAFE_INTEGER,
  ];
  for (const seconds of stored) {
    const { amount, unit } = durationInput(seconds, whole);
    expect(parseDuration(amount, unit, whole), String(seconds)).toEqual({
      ok: true,
      seconds,
    });
  }
  for (const seconds of [0.001, 0.5, 1.5, 90.25, 3600, 0.1 + 0.2]) {
    const { amount, unit } = durationInput(seconds, perGiB);
    expect(parseDuration(amount, unit, perGiB), String(seconds)).toEqual({
      ok: true,
      seconds,
    });
  }
});

test("an amount and a unit multiply out exactly", () => {
  const entered: [string, DurationUnit, number][] = [
    ["90", "seconds", 90],
    ["90", "minutes", 5400],
    ["36", "hours", 129_600],
    ["3", "days", 259_200],
    ["1.5", "hours", 5400],
    ["0.5", "minutes", 30],
    [".25", "days", 21_600],
    ["2.", "minutes", 120],
    ["1e2", "minutes", 6000],
    ["15E-1", "minutes", 90],
    // In floating point these come to 3960.0000000000005,
    // 3617.9999999999995, and 491.99999999999994.
    ["1.1", "hours", 3960],
    ["1.005", "hours", 3618],
    ["8.2", "minutes", 492],
  ];
  for (const [amount, unit, seconds] of entered) {
    expect(parseDuration(amount, unit, whole), `${amount} ${unit}`).toEqual({
      ok: true,
      seconds,
    });
  }
  expect(parseDuration(" 2 ", "days", whole)).toEqual({
    ok: true,
    seconds: 172_800,
  });
});

test("an empty amount is no time, whatever the unit", () => {
  expect(parseDuration("", "days", whole)).toEqual({ ok: true, seconds: null });
  expect(parseDuration("  ", "hours", whole)).toEqual({
    ok: true,
    seconds: null,
  });
});

test("an amount that is not a whole number of seconds is refused, not rounded", () => {
  expect(parseDuration("1.5", "seconds", whole)).toEqual({
    ok: false,
    message: "Enter a whole number of seconds.",
  });
  expect(parseDuration("0.001", "minutes", whole)).toEqual({
    ok: false,
    message: "Enter a whole number of seconds. 0.001 minutes is 0.06 seconds.",
  });
  expect(parseDuration("1.00001", "hours", whole)).toEqual({
    ok: false,
    message:
      "Enter a whole number of seconds. 1.00001 hours is 3600.036 seconds.",
  });
  expect(parseDuration("0.3333333", "days", whole)).toEqual({
    ok: false,
    message:
      "Enter a whole number of seconds. 0.3333333 days is 28799.99712 seconds.",
  });
  // One part in 10^30 over a whole second is still not a whole second.
  expect(
    parseDuration("1.000000000000000000000000000001", "minutes", whole),
  ).toMatchObject({ ok: false });
});

test("a field whose contract takes fractions of a second keeps them", () => {
  expect(parseDuration("0.5", "seconds", perGiB)).toEqual({
    ok: true,
    seconds: 0.5,
  });
  expect(parseDuration("0.001", "minutes", perGiB)).toEqual({
    ok: true,
    seconds: 0.06,
  });
  expect(parseDuration("1", "hours", perGiB)).toEqual({
    ok: true,
    seconds: 3600,
  });
});

test("a time outside the field's range names the limit in the field's units", () => {
  expect(parseDuration("0", "seconds", wait)).toEqual({
    ok: false,
    message: "Enter 1 second or more.",
  });
  expect(parseDuration("-5", "minutes", wait)).toEqual({
    ok: false,
    message: "Enter 1 second or more.",
  });
  expect(parseDuration("61", "minutes", wait)).toEqual({
    ok: false,
    message: "Enter 60 minutes or less.",
  });
  expect(parseDuration("60", "minutes", wait)).toEqual({
    ok: true,
    seconds: 3600,
  });
  expect(parseDuration("0", "hours", perGiB)).toEqual({
    ok: false,
    message: "Enter 0.001 seconds or more.",
  });
  expect(parseDuration("0", "days", { ...whole, min: 0 })).toEqual({
    ok: true,
    seconds: 0,
  });
});

test("a time too long to count in seconds is refused", () => {
  expect(parseDuration("9007199254740992", "seconds", whole)).toEqual({
    ok: false,
    message: "Enter a shorter time.",
  });
  expect(parseDuration("1e300", "days", whole)).toEqual({
    ok: false,
    message: "Enter a shorter time.",
  });
});

test("what is not a number says so", () => {
  for (const amount of [
    "abc",
    "1,5",
    "1 2",
    "-",
    ".",
    "1e",
    "0x10",
    "1e5000",
  ]) {
    expect(parseDuration(amount, "seconds", whole), amount).toEqual({
      ok: false,
      message: "Enter a number.",
    });
  }
});

test("a stored time reads as words", () => {
  expect(formatDuration(1)).toBe("1 second");
  expect(formatDuration(0)).toBe("0 seconds");
  expect(formatDuration(90)).toBe("90 seconds");
  expect(formatDuration(1800)).toBe("30 minutes");
  expect(formatDuration(3600)).toBe("1 hour");
  expect(formatDuration(3600, ["seconds", "minutes"])).toBe("60 minutes");
  expect(formatDuration(604_800)).toBe("7 days");
  expect(formatDuration(0.001)).toBe("0.001 seconds");
});

test("a submitted form's amount and unit are read by the field's name", () => {
  const form = new FormData();
  form.set("wait", "2");
  form.set("waitUnit", "minutes");
  expect(readDuration(form, "wait", wait)).toEqual({ ok: true, seconds: 120 });
  form.set("wait", "0.01");
  expect(readDuration(form, "wait", wait)).toEqual({
    ok: false,
    message: "Enter a whole number of seconds. 0.01 minutes is 0.6 seconds.",
  });
});

test("a form without the field, or with a unit that does not exist, is a broken form", () => {
  const form = new FormData();
  expect(() => readDuration(form, "wait", wait)).toThrow("Missing wait");
  form.set("wait", "2");
  expect(() => readDuration(form, "wait", wait)).toThrow("Missing wait");
  form.set("waitUnit", "fortnights");
  expect(() => readDuration(form, "wait", wait)).toThrow(
    "Unknown duration unit fortnights",
  );
  expect(durationUnit("hours")).toBe("hours");
});
