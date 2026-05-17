import { describe, expect, test } from "bun:test";
import {
  buildImageOnlySkipEmailContent,
  parseGitStatusLine,
  shouldCreateDataDragonPr,
  type GitStatusEntry,
} from "./data-dragon-diff.ts";
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
});

describe("shouldCreateDataDragonPr", () => {
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
