import { expect, test } from "vitest";
import { validateMacSession } from "../apple-acceptance/mac-session.ts";

test("only an unlocked on-console Mac passes the native boundary", () => {
  expect(() =>
    validateMacSession({ onConsole: true, locked: false }),
  ).not.toThrow();
  for (const invalid of [
    { onConsole: true, locked: true },
    { onConsole: false, locked: false },
    { onConsole: true },
    { onConsole: true, locked: "false" },
    { onConsole: true, locked: false, extra: true },
    null,
  ])
    expect(() => validateMacSession(invalid)).toThrow();
});
