import { expect, test } from "vitest";
import {
  SubtitleReplacementDetailSchema,
  SubtitleReplacementStateSchema,
} from "#shared/subtitle-replacement.ts";
import { REPLACEMENT_STATE, SUBTITLE_QUALITY } from "./vocabulary.ts";

function keys(map: object): string[] {
  return Object.keys(map).sort();
}

// The server parses every replacement it returns with this schema, so a state
// outside it can never reach the page, and a state inside it must have copy.
test("the page words exactly the replacement states the server returns", () => {
  expect(keys(REPLACEMENT_STATE)).toEqual(
    [...SubtitleReplacementStateSchema.options].sort(),
  );
});

test("the page words every subtitle quality the server returns", () => {
  expect(keys(SUBTITLE_QUALITY)).toEqual(
    [...SubtitleReplacementDetailSchema.shape.oldQuality.options].sort(),
  );
});
