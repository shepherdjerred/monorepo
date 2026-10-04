import { expect, test } from "vitest";
import { parseTimeout } from "#lib/ci/arguments.ts";

test("timeout accepts explicit units and rejects missing, negative, and excessive durations", () => {
  expect(parseTimeout("2h")).toBe(7_200_000);
  expect(parseTimeout("0.5s")).toBe(500);
  for (const value of ["2", "0s", "-1h", "999999999h", "soon"])
    expect(() => parseTimeout(value)).toThrow();
});

test("help is available without credentials and describes the wait contract", async () => {
  const child = Bun.spawn(["bun", "run", "src/index.ts", "ci", "--help"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  expect(code).toBe(0);
  expect(output).toContain("default: unlimited");
  expect(output).toContain("5 main red");
});

test("bad flags emit a single parseable JSON error and exit 2 before authentication", async () => {
  for (const args of [
    ["wait", "99", "--until", "anything"],
    ["wait", "99", "--timeout", "0s"],
    ["load", "--head", "a".repeat(40)],
  ]) {
    const child = Bun.spawn(
      ["bun", "run", "src/index.ts", "ci", ...args, "--json"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [output, code] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    expect(code).toBe(2);
    expect(JSON.parse(output)).toMatchObject({
      outcome: "error",
      ready: false,
    });
  }
});
