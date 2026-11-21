import type { GitStatusEntry } from "#activities/data-dragon/data-dragon-diff.ts";
import { describe, expect, test } from "vitest";
import {
  CHAMPION_META_SNAPSHOT_PATH,
  ChampionMetaWorkflowInputSchema,
  championMetaBranchName,
  championMetaDisallowedPaths,
} from "./champion-meta-refresh.ts";

function entry(path: string, previousPath?: string): GitStatusEntry {
  return { statusCode: "M", path, previousPath, kind: "modified" };
}

describe("champion-meta refresh", () => {
  test("names the branch from the content hash", () => {
    expect(championMetaBranchName("0123456789ab")).toBe(
      "chore/scout-champion-meta-0123456789ab",
    );
  });

  test("allows only the snapshot to change", () => {
    expect(
      championMetaDisallowedPaths([
        entry(CHAMPION_META_SNAPSHOT_PATH),
        entry("packages/scout-for-lol/README.md"),
        entry("x.json", CHAMPION_META_SNAPSHOT_PATH),
      ]),
    ).toEqual(["packages/scout-for-lol/README.md", "x.json"]);
  });

  test("requires an origin URL", () => {
    expect(() =>
      ChampionMetaWorkflowInputSchema.parse({ metaOrigin: "nope" }),
    ).toThrow();
  });
});
