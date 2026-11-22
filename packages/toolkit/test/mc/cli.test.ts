import { describe, expect, test } from "vitest";
import { runMcCommand } from "./command.ts";

describe("toolkit mc argument handling", () => {
  test("prints usage with no subcommand", async () => {
    const { stdout, exitCode } = await runMcCommand([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("toolkit mc sandbox up");
  });

  test("fails on an unknown command", async () => {
    const { stderr, exitCode } = await runMcCommand(["bogus"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('unknown mc command "bogus"');
  });

  test("requires --world for WorldEdit before contacting the daemon", async () => {
    const { stderr, exitCode } = await runMcCommand(["we", "//set stone"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--world is required");
  });

  test("rejects non-WorldEdit commands passed to we", async () => {
    const { stderr, exitCode } = await runMcCommand([
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
      const { stderr, exitCode } = await runMcCommand(args);
      expect(exitCode).toBe(1);
      expect(stderr).not.toContain("Unknown option");
      expect(stderr).toContain("toolkit mc daemon start");
    },
  );

  test.each([["we"], ["region"], ["sandbox"], ["snapshot"]])(
    "%s --help prints that subcommand's usage",
    async (subcommand) => {
      const { stdout, exitCode } = await runMcCommand([subcommand, "--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain(`toolkit mc ${subcommand}`);
      expect(stdout).toContain("Common options:");
    },
  );

  test("reports the start hint when no daemon is running", async () => {
    const { stderr, exitCode } = await runMcCommand(["cmd", "list"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("toolkit mc daemon start");
  });

  test("accepts --rollout-deployment on real-map sandbox up and rejects --rollout-environment", async () => {
    const { stdout } = await runMcCommand(["sandbox", "--help"]);
    expect(stdout).toContain("--rollout-deployment <catalog>/<stage>");
    expect(stdout).not.toContain("--rollout-environment");

    const valid = await runMcCommand([
      "sandbox",
      "up",
      "--profile",
      "storm-dev",
      "--world",
      "real-map",
      "--map-directory",
      "/maps/source",
      "--map-spawn",
      "[0,64,0]",
      "--rollout-url",
      "https://flags.tailnet-1a49.ts.net",
      "--rollout-deployment",
      "minecraft/tsmc",
    ]);
    expect(valid.exitCode).toBe(1);
    expect(valid.stderr).not.toContain("Unknown option");
    expect(valid.stderr).toContain("toolkit mc daemon start");

    const legacy = await runMcCommand([
      "sandbox",
      "up",
      "--rollout-url",
      "https://flags.tailnet-1a49.ts.net",
      "--rollout-environment",
      "prod",
    ]);
    expect(legacy.exitCode).toBe(1);
    expect(legacy.stderr).toContain("Unknown option '--rollout-environment'");
  });
});

describe("toolkit mc live argument handling", () => {
  test("live undo requires --reason before contacting the daemon", async () => {
    const undo = await runMcCommand(["live", "undo", "lj-abc-123456"]);
    expect(undo.exitCode).toBe(1);
    expect(undo.stderr).toContain("--reason is required");
  });

  test("rejects a malformed --affects", async () => {
    const { stderr, exitCode } = await runMcCommand([
      "we",
      "--world",
      "world",
      "--affects",
      "1,2,3",
      "//sphere stone 3",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--affects must be x1,y1,z1:x2,y2,z2");
  });

  test("accepts live write flags on target commands", async () => {
    const { stderr, exitCode } = await runMcCommand([
      "cmd",
      "--target",
      "live",
      "--reason",
      "screenshots",
      "--allow-players",
      "time",
      "set",
      "day",
    ]);
    // Parsing succeeds and the command reaches the (absent) daemon.
    expect(exitCode).toBe(1);
    expect(stderr).not.toContain("Unknown option");
    expect(stderr).toContain("toolkit mc daemon start");
  });

  test("live --help lists the live commands", async () => {
    const { stdout, exitCode } = await runMcCommand(["live", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("toolkit mc live status");
    expect(stdout).toContain("toolkit mc live undo");
  });
});
