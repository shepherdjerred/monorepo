import { expect, test } from "vitest";
import {
  libraryInterest,
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
test("the household is following a title while anyone's request stands, and each person's own interest is theirs alone", () => {
  const following = {
    userId: "requester",
    active: true,
    excluded: false,
    keepingPolicy: "temporary" as const,
    interestState: "following",
  };
  const temporary = node("movie", false);
  temporary.requests.push(following);
  const kept = node("movie", true);
  kept.requests.push(following);
  for (const media of [temporary, kept])
    for (const actorId of ["member", "requester"])
      expect(libraryViewPolicy(media, actorId).householdFollowing).toBe(true);
  expect(libraryViewPolicy(node("movie", true), "member")).toMatchObject({
    householdFollowing: false,
  });
  // A finished, cancelled or excluded request no longer stands, for anyone.
  for (const ended of [
    { interestState: "finished" },
    { active: false },
    { excluded: true },
  ]) {
    const media = node("movie", false);
    media.requests.push({ ...following, ...ended });
    const policy = libraryViewPolicy(media, "requester");
    expect(policy.householdFollowing).toBe(false);
    expect(libraryInterest(media, policy, "requester")).toBe("released");
  }
  expect(
    libraryInterest(
      temporary,
      libraryViewPolicy(temporary, "requester"),
      "requester",
    ),
  ).toBe("following");
  expect(
    libraryInterest(
      temporary,
      libraryViewPolicy(temporary, "member"),
      "member",
    ),
  ).toBe("none");
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
