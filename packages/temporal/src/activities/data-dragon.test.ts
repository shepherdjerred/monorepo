import { describe, expect, test } from "bun:test";
import {
  buildImageOnlySkipEmailContent,
  parseGitStatusLine,
  shouldCreateDataDragonPr,
  type GitStatusEntry,
} from "./data-dragon-diff.ts";
import { runCommand } from "./data-dragon-shell.ts";
import type { DataDragonUpdateInput } from "./data-dragon.ts";

function parseStatusLines(lines: string[]): GitStatusEntry[] {
  return lines.map((line) => {
    const parsed = parseGitStatusLine(line);
    if (parsed === undefined) {
      throw new Error(`Expected parsed git status entry for ${line}`);
    }
    return parsed;
  });
}

function parseStatusOutput(output: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = [];
  for (const line of output.split("\n")) {
    const parsed = parseGitStatusLine(line);
    if (parsed !== undefined) {
      entries.push(parsed);
    }
  }
  return entries;
}

const IMAGE_PATH =
  "packages/scout-for-lol/packages/data/src/data-dragon/assets/img/augment/acceleratingsorcery_large.png";
const JPG_IMAGE_PATH =
  "packages/scout-for-lol/packages/data/src/data-dragon/assets/img/champion-loading/Fiddlesticks_46.jpg";
const ARENA_SVG_SNAPSHOT =
  "packages/scout-for-lol/packages/report/src/html/arena/__snapshots__/1.svg";
const ARENA_HASH_SNAPSHOT =
  "packages/scout-for-lol/packages/report/src/html/arena/__snapshots__/realdata.integration.test.ts.snap";
const DATA_JSON_PATH =
  "packages/scout-for-lol/packages/data/src/data-dragon/assets/champion/Fiddlesticks.json";
const GENERATED_TS_PATH =
  "packages/scout-for-lol/packages/data/src/data-dragon/champion-name-overrides.generated.ts";
const TEST_LANE_PRIORS_CONFIG: DataDragonUpdateInput["lanePriors"] = {
  bucket: "scout-test-bucket",
  queueIds: [400, 420, 440, 480, 490],
  trainingStartDate: "2026-05-06",
  trainingEndDate: "2026-05-13",
  holdoutStartDate: "2026-05-14",
  holdoutEndDate: "2026-05-16",
  holdoutSampleSize: 100,
  holdoutSeed: "test-seed",
  threshold: 0.95,
};

describe("parseGitStatusLine", () => {
  test("preserves paths for unstaged modifications", () => {
    expect(parseGitStatusLine(` M ${IMAGE_PATH}`)).toEqual({
      statusCode: " M",
      path: IMAGE_PATH,
      previousPath: undefined,
      kind: "modified",
    });
  });

  test("parses renamed paths", () => {
    expect(
      parseGitStatusLine(
        `R  ${IMAGE_PATH} -> packages/scout-for-lol/packages/data/src/data-dragon/assets/img/augment/new_large.png`,
      ),
    ).toEqual({
      statusCode: "R ",
      path: "packages/scout-for-lol/packages/data/src/data-dragon/assets/img/augment/new_large.png",
      previousPath: IMAGE_PATH,
      kind: "renamed",
    });
  });

  test("rejects trimmed porcelain lines", () => {
    expect(() => parseGitStatusLine(`M ${IMAGE_PATH}`)).toThrow(
      "Unexpected git status line",
    );
  });
});

describe("runCommand", () => {
  test("preserves leading status whitespace when requested", async () => {
    const statusOutput = ` M ${IMAGE_PATH}\n`;

    await expect(
      runCommand(["printf", "%s", statusOutput], {
        cwd: ".",
        trimStdout: false,
      }),
    ).resolves.toBe(statusOutput);
  });
});

describe("shouldCreateDataDragonPr", () => {
  test("skips modified existing images when first porcelain line starts with status-space", () => {
    const changes = parseStatusOutput(
      [` M ${IMAGE_PATH}`, ` M ${ARENA_SVG_SNAPSHOT}`, ""].join("\n"),
    );

    expect(changes).toEqual([
      {
        statusCode: " M",
        path: IMAGE_PATH,
        previousPath: undefined,
        kind: "modified",
      },
      {
        statusCode: " M",
        path: ARENA_SVG_SNAPSHOT,
        previousPath: undefined,
        kind: "modified",
      },
    ]);
    expect(shouldCreateDataDragonPr(changes)).toBe(false);
  });

  test("skips modified existing raster images", () => {
    const changes = parseStatusLines([
      ` M ${IMAGE_PATH}`,
      ` M ${JPG_IMAGE_PATH}`,
    ]);

    expect(shouldCreateDataDragonPr(changes)).toBe(false);
  });

  test("skips modified existing images plus generated arena visual snapshots", () => {
    const changes = parseStatusLines([
      ` M ${IMAGE_PATH}`,
      ` M ${ARENA_SVG_SNAPSHOT}`,
      ` M ${ARENA_HASH_SNAPSHOT}`,
    ]);

    expect(shouldCreateDataDragonPr(changes)).toBe(false);
  });

  test("creates a PR for added images", () => {
    const changes = parseStatusLines([`A  ${IMAGE_PATH}`]);

    expect(shouldCreateDataDragonPr(changes)).toBe(true);
  });

  test("creates a PR for deleted images", () => {
    const changes = parseStatusLines([` D ${IMAGE_PATH}`]);

    expect(shouldCreateDataDragonPr(changes)).toBe(true);
  });

  test("creates a PR for renamed images", () => {
    const changes = parseStatusLines([
      `R  ${IMAGE_PATH} -> packages/scout-for-lol/packages/data/src/data-dragon/assets/img/augment/new_large.png`,
    ]);

    expect(shouldCreateDataDragonPr(changes)).toBe(true);
  });

  test("creates a PR for untracked images", () => {
    const changes = parseStatusLines([`?? ${IMAGE_PATH}`]);

    expect(shouldCreateDataDragonPr(changes)).toBe(true);
  });

  test("creates a PR for JSON data changes", () => {
    const changes = parseStatusLines([` M ${DATA_JSON_PATH}`]);

    expect(shouldCreateDataDragonPr(changes)).toBe(true);
  });

  test("creates a PR for TypeScript generated data changes", () => {
    const changes = parseStatusLines([` M ${GENERATED_TS_PATH}`]);

    expect(shouldCreateDataDragonPr(changes)).toBe(true);
  });

  test("creates a PR for mixed image and JSON changes", () => {
    const changes = parseStatusLines([
      ` M ${IMAGE_PATH}`,
      ` M ${DATA_JSON_PATH}`,
    ]);

    expect(shouldCreateDataDragonPr(changes)).toBe(true);
  });
});

describe("buildImageOnlySkipEmailContent", () => {
  test("builds the expected Postal message content", () => {
    const input: DataDragonUpdateInput = {
      mode: "weekly-refresh",
      currentVersion: "16.10.1",
      latestVersion: "16.10.1",
      updateRequired: false,
      lanePriors: TEST_LANE_PRIORS_CONFIG,
    };

    const content = buildImageOnlySkipEmailContent(input, 214);

    expect(content.subject).toBe(
      "Scout Data Dragon refresh skipped: image-only changes",
    );
    expect(content.tag).toBe("scout-data-dragon");
    expect(content.htmlBody).toContain("Mode: weekly-refresh");
    expect(content.htmlBody).toContain("Current version: 16.10.1");
    expect(content.htmlBody).toContain("Latest version: 16.10.1");
    expect(content.htmlBody).toContain("Changed files: 214");
    expect(content.htmlBody).toContain("did not create a PR");
  });
});
