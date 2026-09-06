import { describe, expect, test } from "vitest";
import {
  expandMediaQueries,
  historyReferenceQuery,
  inferMediaIntent,
} from "@shepherdjerred/streambot/discovery/media-intent.ts";

describe("media intent", () => {
  test("treats character performances as both ordinary and AI-cover searches", () => {
    const intent = inferMediaIntent({ query: "play Begging by Plankton" });

    expect(intent).toMatchObject({
      work: "Beggin",
      performer: "Plankton",
      rendition: "unspecified",
      source: "auto",
    });
    expect(expandMediaQueries(intent)).toEqual([
      "Beggin Plankton",
      "Beggin Plankton AI cover",
    ]);
  });

  test("preserves explicit AI-cover and source/placement choices", () => {
    const intent = inferMediaIntent({
      query: "Beggin by Plankton AI cover",
      source: "youtube",
      placement: "now",
    });

    expect(intent).toMatchObject({
      work: "Beggin",
      performer: "Plankton",
      rendition: "ai_cover",
      source: "youtube",
      placement: "now",
    });
    expect(expandMediaQueries(intent)).toEqual(["Beggin Plankton AI cover"]);
  });

  test("extracts a subject from a conversational history reference", () => {
    expect(historyReferenceQuery("play that Plankton song again")).toBe(
      "Plankton",
    );
    expect(historyReferenceQuery("play the previous one")).toBe("");
  });
});
