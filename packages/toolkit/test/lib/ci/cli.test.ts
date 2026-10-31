import { expect, test } from "vitest";
import { parseTimeout } from "#lib/ci/arguments.ts";
import { runCi } from "./cli-process.ts";

test("timeout accepts explicit units and rejects missing, negative, and excessive durations", () => {
  expect(parseTimeout("2h")).toBe(7_200_000);
  expect(parseTimeout("0.5s")).toBe(500);
  for (const value of ["2", "0s", "-1h", "999999999h", "soon"])
    expect(() => parseTimeout(value)).toThrow();
});

test("help is available without credentials and describes the wait contract", async () => {
  const { output, error, code } = await runCi(["--help"]);
  expect(code, error).toBe(0);
  expect(output).toContain("default: unlimited");
  expect(output).toContain("5 main red");
});

test("bad flags emit a single parseable JSON error and exit 2 before authentication", async () => {
  for (const args of [
    ["wait", "99", "--until", "anything"],
    ["wait", "99", "--timeout", "0s"],
    ["load", "--head", "a".repeat(40)],
    ["timings", "99"],
    ["timings", "--head", "a".repeat(40)],
    ["timings", "--since", "0h"],
    ["main", "--since", "1h"],
  ]) {
    const { output, error, code } = await runCi([...args, "--json"]);
    expect(code, error).toBe(2);
    expect(JSON.parse(output)).toMatchObject({
      outcome: "error",
      ready: false,
    });
  }
});

test("benchmark help is credential-free and malformed evidence arguments fail before authentication", async () => {
  for (const args of [
    ["--help"],
    ["evidence", "123", "--variant", "candidate"],
    ["evidence", "123", "--head", "a".repeat(40), "--variant", "other"],
    [
      "evidence",
      "123",
      "456",
      "--head",
      "a".repeat(40),
      "--variant",
      "candidate",
    ],
  ]) {
    const { output, error, code } = await runCi([
      "benchmark",
      ...args,
      "--json",
    ]);
    if (args[0] === "--help") {
      expect(code, error).toBe(0);
      expect(output).toContain("does not qualify physical savings");
    } else {
      expect(code, error).toBe(2);
      expect(JSON.parse(output)).toMatchObject({ outcome: "error" });
    }
    expect(error).not.toContain("via service-account");
  }
});
