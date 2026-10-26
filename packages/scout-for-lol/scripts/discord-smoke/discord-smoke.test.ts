import { expect, test } from "vitest";
import { parseDiscordSmokeArguments } from "./discord-smoke.ts";
test("accepts the gateway smoke scenario", () => {
  expect(parseDiscordSmokeArguments(["--scenario", "gateway"])).toEqual({
    kind: "fresh",
    scenario: "gateway",
  });
});
test.each([
  ["--scenario", "bb-transfer"],
  ["--scenario", "other"],
  ["--resume", "run-1"],
])("rejects retired or unknown smoke arguments: %s", (...args) => {
  expect(() => parseDiscordSmokeArguments(args)).toThrow();
});
