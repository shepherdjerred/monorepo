import path from "node:path";
import { describe, expect, test } from "vitest";

const entry = path.resolve(import.meta.dirname, "../../src/index.ts");

async function run(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", entry, "mc", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, HOME: "/nonexistent-toolkit-mc-test" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("toolkit mc argument handling", () => {
  test("prints usage with no subcommand", async () => {
    const { stdout, exitCode } = await run([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("toolkit mc sandbox up");
  });

  test("fails on an unknown command", async () => {
    const { stderr, exitCode } = await run(["bogus"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('unknown mc command "bogus"');
  });

  test("requires --world for WorldEdit before contacting the daemon", async () => {
    const { stderr, exitCode } = await run(["we", "//set stone"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--world is required");
  });

  test("rejects non-WorldEdit commands passed to we", async () => {
    const { stderr, exitCode } = await run([
      "we",
      "--world",
      "world",
      "say hi",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("WorldEdit commands start with //");
  });

  test.each([
    ["we", "--pos1", "-1,-46,-4", "--world", "world", "//set air"],
    ["region", "read", "--world", "world", "-6,-61,-6", "6,-44,6"],
    ["cmd", "tp", "agent", "-60", "0"],
  ])(
    "parses negative coordinates in %s without --opt= or --",
    async (...args) => {
      // Parsing succeeds and the command reaches the (absent) daemon.
      const { stderr, exitCode } = await run(args);
      expect(exitCode).toBe(1);
      expect(stderr).not.toContain("Unknown option");
      expect(stderr).toContain("toolkit mc daemon start");
    },
  );

  test.each([["we"], ["region"], ["sandbox"], ["snapshot"]])(
    "%s --help prints that subcommand's usage",
    async (subcommand) => {
      const { stdout, exitCode } = await run([subcommand, "--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain(`toolkit mc ${subcommand}`);
      expect(stdout).toContain("Common options:");
    },
  );

  test("reports the start hint when no daemon is running", async () => {
    const { stderr, exitCode } = await run(["cmd", "list"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("toolkit mc daemon start");
  });
});
