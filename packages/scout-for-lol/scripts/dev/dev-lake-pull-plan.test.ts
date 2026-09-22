import { describe, expect, test } from "vitest";
import {
  LAKE_STAGES,
  buildEntryFileCountCommand,
  buildEntryTarCommand,
  buildTableListCommand,
  currentBuildCommand,
  datasetPinPath,
  defaultLakeDestination,
  lakeDestinationIssues,
  parseDevLakePullArgs,
} from "./dev-lake-pull-plan.ts";

const ENVIRONMENT = { XDG_DATA_HOME: "/data-home", HOME: "/home/someone" };

function options(args: readonly string[]) {
  const result = parseDevLakePullArgs(args, ENVIRONMENT);
  if (result.kind !== "options") {
    throw new Error("Expected options, got help");
  }
  return result.options;
}

describe("LAKE_STAGES", () => {
  test("covers both stages with the backend pod selector", () => {
    // `app=scout-backend` is the chart's deliberate label; a looser selector
    // would also match the Patroni postgres pods, which hold no lake.
    expect(LAKE_STAGES.beta.selector).toBe("app=scout-backend");
    expect(LAKE_STAGES.prod.selector).toBe("app=scout-backend");
    expect(LAKE_STAGES.beta.namespace).toBe("scout-beta");
    expect(LAKE_STAGES.prod.namespace).toBe("scout-prod");
  });

  test("reads the lake from the pod's PVC mount", () => {
    expect(LAKE_STAGES.beta.lakeDir).toBe("/data/report-lake");
  });
});

describe("defaultLakeDestination", () => {
  test("puts each stage's lake under its own dataset directory", () => {
    expect(defaultLakeDestination("beta", ENVIRONMENT)).toBe(
      "/data-home/scout-for-lol/stage-dataset/beta/report-lake",
    );
    expect(defaultLakeDestination("prod", ENVIRONMENT)).toBe(
      "/data-home/scout-for-lol/stage-dataset/prod/report-lake",
    );
  });

  test("falls back to ~/.local/share", () => {
    expect(defaultLakeDestination("beta", { HOME: "/home/someone" })).toBe(
      "/home/someone/.local/share/scout-for-lol/stage-dataset/beta/report-lake",
    );
  });

  test("keeps the pin beside the lake it describes", () => {
    expect(datasetPinPath("beta", ENVIRONMENT)).toBe(
      "/data-home/scout-for-lol/stage-dataset/beta/dataset.json",
    );
  });
});

describe("lakeDestinationIssues", () => {
  test("accepts a normal dataset lake path", () => {
    expect(
      lakeDestinationIssues("/data-home/scout-for-lol/beta/report-lake"),
    ).toEqual([]);
  });

  test("refuses the filesystem root", () => {
    expect(lakeDestinationIssues("/").length).toBeGreaterThan(0);
  });

  test("refuses a relative path", () => {
    expect(lakeDestinationIssues("report-lake")).toEqual([
      expect.stringContaining("must be absolute"),
    ]);
  });

  test("refuses a suspiciously shallow path", () => {
    expect(lakeDestinationIssues("/report-lake")).toEqual([
      expect.stringContaining("suspiciously shallow"),
    ]);
  });

  test("refuses a directory that was never a lake", () => {
    // The copy deletes its destination, so a mistyped flag must not be able to
    // point at something else entirely.
    expect(lakeDestinationIssues("/home/someone/Documents")).toEqual([
      expect.stringContaining("must be named report-lake"),
    ]);
  });
});

describe("parseDevLakePullArgs", () => {
  test("defaults to beta", () => {
    expect(options([]).stage).toBe("beta");
    expect(options([]).destination).toBe(
      "/data-home/scout-for-lol/stage-dataset/beta/report-lake",
    );
  });

  test("accepts prod", () => {
    expect(options(["--stage", "prod"]).stage).toBe("prod");
  });

  test("rejects an unknown stage", () => {
    expect(() => options(["--stage", "staging"])).toThrow(
      /--stage must be beta or prod/,
    );
  });

  test("stages the copy beside the destination, never in place", () => {
    const parsed = options([]);
    expect(parsed.staging).toBe(`${parsed.destination}.pulling`);
  });

  test("refuses a dangerous destination rather than deleting it", () => {
    expect(() => options(["--destination", "/home/someone"])).toThrow(
      /Refusing to use this destination/,
    );
  });

  test("returns help for --help", () => {
    expect(parseDevLakePullArgs(["--help"], ENVIRONMENT).kind).toBe("help");
  });

  test("rejects an unknown argument rather than ignoring it", () => {
    expect(() => options(["--wat"])).toThrow(/Unknown argument/);
  });

  test("requires a value after each flag", () => {
    expect(() => options(["--stage"])).toThrow(/--stage requires a value/);
    expect(() => options(["--destination"])).toThrow(
      /--destination requires a value/,
    );
  });
});

describe("pod commands", () => {
  test("reads CURRENT from the lake directory", () => {
    expect(currentBuildCommand(LAKE_STAGES.beta)).toEqual([
      "cat",
      "/data/report-lake/CURRENT",
    ]);
  });

  test("lists the entries inside a build", () => {
    expect(buildTableListCommand(LAKE_STAGES.beta, "build-123")).toEqual([
      "ls",
      "/data/report-lake/builds/build-123",
    ]);
  });

  test("tars one entry at a time, rooted at the build", () => {
    // Per-entry because a single ~900MB kubectl pipe truncates in practice.
    expect(
      buildEntryTarCommand(LAKE_STAGES.beta, "build-123", "matches"),
    ).toEqual([
      "tar",
      "-cf",
      "-",
      "-C",
      "/data/report-lake/builds/build-123",
      "matches",
    ]);
  });

  test("counts an entry's files on the pod, for verifying the copy", () => {
    expect(
      buildEntryFileCountCommand(LAKE_STAGES.beta, "build-123", "matches"),
    ).toEqual([
      "sh",
      "-c",
      "find /data/report-lake/builds/build-123/matches -type f | wc -l",
    ]);
  });

  test("never names a staging directory, so the snapshot stays frozen", () => {
    const command = buildEntryTarCommand(
      LAKE_STAGES.beta,
      "build-123",
      "matches",
    ).join(" ");
    expect(command).not.toContain("-recent");
  });
});
