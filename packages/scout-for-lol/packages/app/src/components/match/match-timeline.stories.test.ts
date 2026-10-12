import { expect, test } from "vitest";
import * as stories from "./match-timeline.stories.tsx";

test("timeline stories load their validated identity fixtures before rendering", () => {
  // Loading any story also initializes every frame fixture. A malformed PUUID
  // throws here even for stories which do not themselves render the frame table.
  expect(stories.default.title).toBe("Match/Timeline");
  for (const story of [
    stories.Retained,
    stories.NotCaptured,
    stories.Loading,
    stories.FrameTable,
    stories.FrameTableError,
    stories.Pagination,
    stories.ChampionPicker,
  ]) {
    expect(story.args?.matchId).toBe("NA1_4912837465");
  }
});
