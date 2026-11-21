import { expect, test } from "vitest";
import {
  libraryInterest,
  libraryKeepingView,
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
function title(keep: boolean, following: boolean) {
  return {
    id: "movie",
    version: 6,
    intents: [
      {
        edition: "default",
        libraryKeep: keep,
        libraryPolicyExplicit: false,
        version: 3,
      },
    ],
    requests: following
      ? [
          {
            userId: "requester",
            active: true,
            excluded: false,
            keepingPolicy: "temporary" as const,
            interestState: "following",
          },
        ]
      : [],
  };
}
test("a title's keeping names its policy for everyone and its switch for the owner alone", () => {
  const owner = { actorId: "owner", owner: true };
  const member = { actorId: "requester", owner: false };
  const versions = { mediaVersion: 6, targetVersion: 3 };
  expect(libraryKeepingView(title(true, true), owner)).toMatchObject({
    policy: "keep",
    protection: "keep_indefinitely",
    libraryKeeping: { ...versions, keepingPolicy: "keep" },
  });
  expect(libraryKeepingView(title(false, true), owner)).toMatchObject({
    policy: "temporary",
    protection: "temporary_interest",
    libraryKeeping: { ...versions, keepingPolicy: "temporary" },
  });
  expect(libraryKeepingView(title(false, false), owner)).toMatchObject({
    policy: "unclassified",
    protection: "review_required",
    libraryKeeping: { ...versions, keepingPolicy: "temporary" },
  });
  for (const [keep, following, policy] of [
    [true, true, "keep"],
    [false, true, "temporary"],
    [false, false, "unclassified"],
  ] as const)
    expect(libraryKeepingView(title(keep, following), member)).toMatchObject({
      policy,
      libraryKeeping: null,
    });
  expect(libraryKeepingView(title(false, true), member).claims).toEqual({
    kept: false,
    following: true,
    householdFollowing: true,
  });
  // The switch is the default edition's; a title without one has none.
  expect(
    libraryKeepingView(
      {
        ...title(true, false),
        intents: [
          {
            edition: "directors-cut",
            libraryKeep: true,
            libraryPolicyExplicit: true,
            version: 9,
          },
        ],
      },
      owner,
    ),
  ).toMatchObject({ policy: "unclassified", libraryKeeping: null });
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
