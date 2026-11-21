import { expect, test } from "vitest";
import { RemovalListSchema, RequestListSchema } from "#shared/api.ts";
import { RequestInterestListSchema } from "#shared/household/interests.ts";
import { MovieEditionRequestListV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { mineTitles } from "#client/library/mine-model.ts";
import { leavingTitles, restorable } from "#client/library/removals.ts";
import { movieRequestList } from "./fixtures/movie-requests.ts";
import { removalList } from "./fixtures/removals.ts";
import { interestList, requestList } from "./fixtures/requests.ts";
import { MEMBER } from "./personas.ts";

/*
 * The Library's views are joins over several reads. These run those joins
 * over the fixtures the browser tests and `dev:fixture` serve, so a fixture
 * that stops exercising a join (or a join that stops handling one) fails
 * here, without a browser.
 */

const removals = RemovalListSchema.parse(removalList("owner"));

test("leaving soon is one entry per title, soonest first, without what already left", () => {
  const titles = leavingTitles(removals);
  expect(titles.map((title) => title.name)).toEqual([
    "Get Out",
    "The Expanse",
    "Mr. Robot",
    "Cowboy Bebop",
    "Knives Out",
    "Top Gun: Maverick",
  ]);
  const expanse = titles.find((title) => title.name === "The Expanse");
  expect(expanse?.rows).toHaveLength(4);
  expect(expanse?.rows.every((row) => !row.whole)).toBe(true);
  // The series leaves when its first episode does.
  expect(expanse?.leavesAt).toBe(expanse?.rows[0]?.removal.graceUntil);
  expect(restorable(removals).map((removal) => removal.rootTitle)).toEqual([
    "The Holdovers",
    "Silo",
  ]);
});

function mine(persona: "owner" | "member") {
  const interests = [null, "00000005-0000-4000-8000-00000000000e"].flatMap(
    (cursor) =>
      RequestInterestListSchema.parse(
        interestList(
          new URLSearchParams({
            include: "artwork",
            ...(cursor === null ? {} : { cursor }),
          }),
          persona,
        ),
      ).items,
  );
  return mineTitles({
    requests: RequestListSchema.parse(requestList(persona)),
    interests,
    movieRequests: MovieEditionRequestListV4Schema.parse(
      movieRequestList(MEMBER.id),
    ).items,
    movieSubjectId: MEMBER.id,
    imported: [],
  });
}

test("each title is listed once, however many reads mention it", () => {
  const titles = mine("member");
  const roots = titles.map((title) => title.rootMediaId);
  expect(new Set(roots).size).toBe(roots.length);
  const names = titles.flatMap((title) => title.name ?? []);
  expect(new Set(names).size).toBe(names.length);

  // A film the request list, the interests and the film requests all hold.
  const dune = titles.find((title) => title.name === "Dune: Part Two");
  expect(dune?.asks).toHaveLength(1);
  expect(dune?.asks[0]).toMatchObject({
    request: { rootTitle: "Dune: Part Two" },
    interest: { keepingPolicy: "keep" },
    movie: { access: "detail" },
  });
  // A request for a season and one for an episode name their series.
  expect(names).toContain("Andor");
  expect(names).toContain("Arcane");
  expect(names).not.toContain("Season 2");
});

test("titles waiting on an answer come first, and a withheld film has no name", () => {
  const titles = mine("member");
  const waiting = titles.filter((title) => title.needsAnswer);
  expect(waiting.map((title) => title.name)).toEqual([
    "Shōgun",
    "Slow Horses",
    "The Bear",
  ]);
  expect(titles.slice(0, waiting.length)).toEqual(waiting);
  const withheld = titles.filter((title) => title.name === null);
  expect(withheld).toHaveLength(1);
  expect(withheld[0]?.posterPath).toBeNull();
  expect(withheld[0]?.asks[0]?.movie?.access).toBe("protection_only");
});
