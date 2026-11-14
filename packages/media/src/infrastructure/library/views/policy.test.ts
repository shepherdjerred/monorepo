import { expect, test } from "vitest";
import {
  libraryViewPolicy,
  type LibraryPolicyNode,
} from "#infrastructure/library/views/policy.ts";

function node(id: string, keep: boolean, explicit = false): LibraryPolicyNode {
  return {
    id,
    intents: [
      {
        edition: "default",
        libraryKeep: keep,
        libraryPolicyExplicit: explicit,
      },
    ],
    requests: [],
  };
}
test("an explicit root Temporary overrides migrated leaf Keeps", () => {
  const series = node("series", false, true);
  const season = { ...node("season", true), parent: series };
  const episode = { ...node("episode", true), parent: season };
  expect(libraryViewPolicy(episode, "member").kept).toBe(false);
  expect(
    libraryViewPolicy(
      {
        ...episode,
        intents: [
          {
            edition: "default",
            libraryKeep: true,
            libraryPolicyExplicit: true,
          },
        ],
      },
      "member",
    ).kept,
  ).toBe(true);
});
test("shared permanent Keep is visible without exposing another person's following", () => {
  const media = node("movie", false);
  media.requests.push({
    userId: "owner",
    active: true,
    excluded: false,
    keepingPolicy: "keep",
    interestState: "following",
  });
  expect(libraryViewPolicy(media, "member")).toEqual({
    kept: true,
    following: false,
    householdFollowing: true,
  });
});
test("a whole-series explicit Keep remains visible beneath a temporary leaf policy", () => {
  const series = node("series", true, true);
  const episode = { ...node("episode", false, true), parent: series };
  expect(libraryViewPolicy(episode, "member").kept).toBe(true);
});
test("released own requests and unrelated editions do not create active following", () => {
  const media = node("movie", false);
  media.intents = [
    {
      edition: "directors-cut",
      libraryKeep: true,
      libraryPolicyExplicit: true,
    },
  ];
  media.requests.push({
    userId: "member",
    active: true,
    excluded: false,
    keepingPolicy: "temporary",
    interestState: "finished",
  });
  expect(libraryViewPolicy(media, "member")).toEqual({
    kept: false,
    following: false,
    householdFollowing: false,
  });
});
