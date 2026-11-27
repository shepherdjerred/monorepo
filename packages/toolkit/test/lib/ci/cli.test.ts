import { z } from "zod";
import { expect, test } from "vitest";
import { parseTimeout } from "#lib/ci/arguments.ts";
import { runCi } from "./cli-process.ts";

const ErrorReportSchema = z.object({
  outcome: z.string(),
  ready: z.boolean(),
  error: z.string(),
});

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
  expect(output).toContain("5 PR ready but main red");
  expect(output).toContain("wait --main");
  expect(output).toContain("toolkit pr land");
  expect(output).toContain("--follow");
});

const BAD_FLAG_CASES = [
  ["wait", "99", "--until", "anything"],
  ["wait", "99", "--timeout", "0s"],
  ["load", "--head", "a".repeat(40)],
  ["timings", "99"],
  ["timings", "--head", "a".repeat(40)],
  ["timings", "--since", "0h"],
  ["main", "--since", "1h"],
  ["wait", "--main", "--until", "settled"],
  ["wait", "--main", "99"],
  ["main", "--head", "a".repeat(40)],
  ["load", "--main"],
  ["wait", "99", "--follow"],
  ["explain", "--main", "--follow"],
  ["wait", "--main", "--follow", "--head", "a".repeat(40)],
  ["wait", "99", "--head", "abcdef123456"],
  ["wait", "--main", "--head", "abc12"],
  ["wait", "--main", "--head", "not-a-hex-sha"],
  ["wait", "not-a-pr"],
  ["unknown-subcommand"],
].map((args) => ({ label: args.join(" "), args }));

test.each(BAD_FLAG_CASES)(
  "bad flags ($label) emit a single parseable JSON error without ZodError and exit 2 before authentication",
  async ({ args }) => {
    const { output, error, code } = await runCi([...args, "--json"]);
    expect(code, error).toBe(2);
    const parsed = ErrorReportSchema.parse(JSON.parse(output));
    expect(parsed).toMatchObject({
      outcome: "error",
      ready: false,
    });
    expect(parsed.error).not.toContain("ZodError");
    expect(parsed.error.trim().startsWith("[")).toBe(false);
  },
);

test("short --head error in plain text is human-readable without Zod JSON", async () => {
  const prShort = await runCi(["wait", "99", "--head", "abcdef123456"]);
  expect(prShort.code).toBe(2);
  expect(prShort.error).toContain(
    "--head must be a full 40-character hexadecimal commit SHA",
  );
  expect(prShort.error).not.toContain("ZodError");

  const mainTooShort = await runCi(["wait", "--main", "--head", "abc12"]);
  expect(mainTooShort.code).toBe(2);
  expect(mainTooShort.error).toContain(
    "--head must be a 7 to 40-character hexadecimal commit SHA",
  );
});

const BENCHMARK_CASES = [
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
].map((args) => ({ label: args.join(" "), args }));

test.each(BENCHMARK_CASES)(
  "benchmark ($label) is credential-free and rejects malformed evidence arguments before authentication",
  async ({ args }) => {
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
  },
);
