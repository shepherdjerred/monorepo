import { describe, expect, test } from "vitest";
import {
  ChampionMetaWorkflowInputSchema,
  championMetaBranchName,
} from "./champion-meta-refresh.ts";

describe("champion-meta refresh", () => {
  test("names the branch from the content hash", () => {
    expect(championMetaBranchName("0123456789ab")).toBe(
      "chore/scout-champion-meta-0123456789ab",
    );
  });

  test("requires an origin URL", () => {
    expect(() =>
      ChampionMetaWorkflowInputSchema.parse({ metaOrigin: "nope" }),
    ).toThrow();
  });
});
