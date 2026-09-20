import { describe, expect, test } from "vitest";
import {
  defaultDatasetPinPath,
  parseReplayArgs,
  unknownProfiles,
} from "./cli.ts";

function options(args: readonly string[]) {
  const result = parseReplayArgs(args);
  if (result.kind !== "options") throw new Error("Expected options, got help");
  return result.options;
}

describe("parseReplayArgs defaults", () => {
  test("runs chips across minimal and full", () => {
    const parsed = options([]);
    expect(parsed.stage).toBe("beta");
    expect(parsed.profiles).toEqual(["minimal", "full"]);
    // Chips need no corpus, so they are what an unqualified run does.
    expect(parsed.includeChips).toBe(true);
    expect(parsed.includeConversations).toBe(false);
    expect(parsed.concurrency).toBe(4);
    expect(parsed.limit).toBeNull();
    expect(parsed.write).toBe(false);
  });

  test("does not silently add chips when conversations were asked for", () => {
    const parsed = options(["--conversations"]);
    expect(parsed.includeConversations).toBe(true);
    expect(parsed.includeChips).toBe(false);
  });

  test("runs both when both are named", () => {
    const parsed = options(["--chips", "--conversations"]);
    expect(parsed.includeChips).toBe(true);
    expect(parsed.includeConversations).toBe(true);
  });
});

describe("parseReplayArgs profiles", () => {
  test("accepts a comma-separated matrix", () => {
    expect(options(["--profile", "minimal,full"]).profiles).toEqual([
      "minimal",
      "full",
    ]);
  });

  test("accepts a repeated flag", () => {
    expect(
      options(["--profile", "minimal", "--profile", "bucks-only"]).profiles,
    ).toEqual(["minimal", "bucks-only"]);
  });

  test("deduplicates, so a matrix cell is not paid for twice", () => {
    expect(options(["--profile", "full,full"]).profiles).toEqual(["full"]);
  });

  test("rejects an unknown profile and lists the known ones", () => {
    expect(() => options(["--profile", "everything"])).toThrow(
      /Unknown profile\(s\): everything/,
    );
    expect(() => options(["--profile", "everything"])).toThrow(/minimal/);
  });

  test("ignores empty entries from a trailing comma", () => {
    expect(options(["--profile", "full,"]).profiles).toEqual(["full"]);
  });
});

describe("parseReplayArgs values", () => {
  test("accepts prod", () => {
    expect(options(["--stage", "prod"]).stage).toBe("prod");
  });

  test("rejects an unknown stage", () => {
    expect(() => options(["--stage", "staging"])).toThrow(
      /--stage must be beta or prod/,
    );
  });

  test("reads limit, concurrency, resume, baseline and only", () => {
    const parsed = options([
      "--limit",
      "3",
      "--concurrency",
      "2",
      "--resume",
      "run-1",
      "--baseline",
      "run-0",
      "--only",
      "chip:abc123",
      "--write",
    ]);
    expect(parsed.limit).toBe(3);
    expect(parsed.concurrency).toBe(2);
    expect(parsed.resumeRunId).toBe("run-1");
    expect(parsed.baselineRunId).toBe("run-0");
    expect(parsed.onlyCaseId).toBe("chip:abc123");
    expect(parsed.write).toBe(true);
  });

  test("rejects a non-positive limit or concurrency", () => {
    expect(() => options(["--limit", "0"])).toThrow(/positive integer/);
    expect(() => options(["--concurrency", "-1"])).toThrow(/positive integer/);
    expect(() => options(["--limit", "two"])).toThrow(/positive integer/);
  });

  test("requires a value after each flag", () => {
    for (const flag of [
      "--stage",
      "--profile",
      "--limit",
      "--concurrency",
      "--resume",
      "--baseline",
      "--only",
    ]) {
      expect(() => options([flag])).toThrow(/requires a value/);
    }
  });

  test("rejects an unknown argument rather than ignoring it", () => {
    expect(() => options(["--everything"])).toThrow(/Unknown argument/);
  });

  test("returns help for --help", () => {
    expect(parseReplayArgs(["--help"]).kind).toBe("help");
    expect(parseReplayArgs(["-h"]).kind).toBe("help");
  });
});

describe("unknownProfiles", () => {
  test("is empty for built-ins", () => {
    expect(unknownProfiles(["minimal", "full", "bucks-only"])).toEqual([]);
  });

  test("names only what it does not know", () => {
    expect(unknownProfiles(["full", "nope"])).toEqual(["nope"]);
  });
});

describe("defaultDatasetPinPath", () => {
  test("matches where dev:lake-pull leaves the pin", () => {
    // Mirrors defaultLakeDestination in scripts/dev/dev-lake-pull-plan.ts; if
    // these drift the harness looks for a pin the puller never wrote.
    expect(defaultDatasetPinPath("beta", { XDG_DATA_HOME: "/data-home" })).toBe(
      "/data-home/scout-for-lol/stage-dataset/beta/dataset.json",
    );
    expect(defaultDatasetPinPath("prod", { XDG_DATA_HOME: "/data-home" })).toBe(
      "/data-home/scout-for-lol/stage-dataset/prod/dataset.json",
    );
  });

  test("falls back to ~/.local/share", () => {
    expect(defaultDatasetPinPath("beta", { HOME: "/home/someone" })).toBe(
      "/home/someone/.local/share/scout-for-lol/stage-dataset/beta/dataset.json",
    );
  });
});
