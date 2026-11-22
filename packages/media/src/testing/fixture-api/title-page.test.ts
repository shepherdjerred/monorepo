import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { MediaDetailSchema } from "#shared/api.ts";
import { DefaultTargetViewSchema } from "#shared/editions/target-view.ts";
import { MovieTargetContextV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { FEATURED, titleNamed } from "./fixtures/titles.ts";
import { personaUser, type Persona } from "./personas.ts";
import { routeFixture } from "./router.ts";
import { downloadProgress, titleState } from "#client/title/copy.ts";
import {
  cancellableRequest,
  leavingOf,
  ownInterest,
  televisionFacts,
  versionFacts,
} from "#client/title/facts.ts";
import {
  householdFacts,
  householdNotes,
  selfAsFollower,
  type Fact,
} from "#client/title/household.tsx";
import { titleActions } from "#client/title/primary-action.ts";

/*
 * The fixtures hold a film and a series for every standing the title page
 * acts on, for a member and for the owner. Each case reads the fixture API
 * as the browser does and derives the page's facts and actions from it, so a
 * fixture that drifts from a state the page needs fails here.
 */

/** A fixture body as a browser receives it, parsed as the client parses it. */
async function read<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  persona: Persona,
): Promise<z.output<Schema>> {
  const outcome = routeFixture({
    method: "GET",
    url: new URL(`http://fixture.invalid${path}`),
    persona,
  });
  if (outcome.status !== 200) {
    throw new Error(`${persona} ${path}: HTTP ${String(outcome.status)}`);
  }
  return schema.parse(await Response.json(outcome.body).json());
}

async function television(name: string, persona: Persona) {
  const { id } = titleNamed(name);
  const user = personaUser(persona);
  const media = await read(`/api/v1/media/${id}`, MediaDetailSchema, persona);
  const context = await read(
    `/api/v2/media/${id}/targets/default`,
    DefaultTargetViewSchema,
    persona,
  );
  return { user, media, context, facts: televisionFacts(media, context, user) };
}

async function film(name: string, persona: Persona, edition = "default") {
  const { id } = titleNamed(name);
  const user = personaUser(persona);
  const media = await read(`/api/v1/media/${id}`, MediaDetailSchema, persona);
  const version = await read(
    `/api/v4/media/${id}/movie-editions/${edition}`,
    MovieTargetContextV4Schema,
    persona,
  );
  return { user, media, version, facts: versionFacts(version, media, user) };
}

describe("where a reader stands with a series", () => {
  it("a member who follows it can stop following, and hold it", async () => {
    const { facts, media, user } = await television("Severance", "member");
    expect(facts.following).toBe(true);
    expect(facts.mayStopFollowing).toBe(true);
    // The interest command names the request at the revision it was read at.
    expect(ownInterest(media, user)).toEqual({
      requestId: media.requests[0]?.id,
      version: media.requests[0]?.version,
      interestRevision: media.requests[0]?.interestRevision,
      keepingPolicy: "temporary",
    });
    expect(titleActions(facts)).toEqual({
      primary: "following",
      menu: ["hold", "stop_following"],
    });
  });

  it("a request that keeps the title for good is withdrawn, not let go", async () => {
    const { facts, context, user, media } = await television("Bluey", "member");
    expect(ownInterest(media, user)?.keepingPolicy).toBe("keep");
    expect(facts.mayStopFollowing).toBe(false);
    expect(cancellableRequest(context, user)?.active).toBe(true);
    // Kept for good, so there is nothing for a hold to stop either.
    expect(titleActions(facts)).toEqual({
      primary: "following",
      menu: ["cancel_request"],
    });
    expect(householdNotes(media, user)).toEqual([
      "Your request keeps this for good, so Stop following is not offered. Only the owner can change how long it is kept.",
    ]);
  });

  it("a request whose interest was let go no longer follows the title", async () => {
    // The request still stands, and the interests list calls it dropped.
    const { facts, context, media } = await television("Twin Peaks", "member");
    expect(context.ownRequests.some((request) => request.active)).toBe(true);
    expect(media.requests).toEqual([]);
    expect(facts.following).toBe(false);
    expect(titleActions(facts).primary).toBe("request");
  });

  it("a member who does not follow it can only ask for it", async () => {
    const { facts } = await television("Succession", "member");
    expect(titleActions(facts)).toEqual({ primary: "request", menu: [] });
  });

  it("the owner reads where the keeping switch stands, and can turn it", async () => {
    const kept = await television("Succession", "owner");
    expect(kept.media.libraryKeeping?.keepingPolicy).toBe("keep");
    expect(titleActions(kept.facts)).toEqual({
      primary: "kept_for_good",
      menu: ["request", "keep_for_now", "pin"],
    });
    const temporary = await television("Hacks", "owner");
    expect(temporary.media.libraryKeeping?.keepingPolicy).toBe("temporary");
    expect(titleActions(temporary.facts)).toEqual({
      primary: "keep_for_good",
      menu: ["request", "hold", "pin"],
    });
  });

  it("the switch is read from the owner's own choice, not from the label", async () => {
    // A request keeps Bluey for good while the owner's switch is off.
    const { facts, media } = await television("Bluey", "owner");
    expect(media.policy).toBe("keep");
    expect(media.libraryKeeping?.keepingPolicy).toBe("temporary");
    expect(facts.keeping).toBe("temporary");
    expect(titleActions(facts).menu).toContain("keep_for_good");
    expect(titleActions(facts).menu).not.toContain("keep_for_now");
  });

  it("a season has no switch of its own: its keeping is its series'", async () => {
    const series = titleNamed("Succession");
    const user = personaUser("owner");
    const detail = await read(
      `/api/v1/media/${series.id}`,
      MediaDetailSchema,
      "owner",
    );
    const season = detail.children[0];
    if (season === undefined) throw new Error("Succession has no season");
    const media = await read(
      `/api/v1/media/${season.id}`,
      MediaDetailSchema,
      "owner",
    );
    const context = await read(
      `/api/v2/media/${season.id}/targets/default`,
      DefaultTargetViewSchema,
      "owner",
    );
    const facts = televisionFacts(media, context, user);
    expect(media.libraryKeeping).toEqual(detail.libraryKeeping);
    expect(facts.keeping).toBeNull();
    const { primary, menu } = titleActions(facts);
    expect([primary, ...menu]).not.toContain("keep_for_now");
    expect(householdFacts(media, user, null, "en-US")).toContainEqual({
      term: "Keeping",
      detail: "For good, with the rest of the series",
    });
    expect(householdNotes(media, user)).toEqual([]);
  });

  it("the owner who pinned one can take the pin off", async () => {
    const { facts } = await television("Breaking Bad", "owner");
    expect(titleActions(facts)).toEqual({
      primary: "keep_for_good",
      menu: ["request", "unpin"],
    });
  });

  it("anyone can hold a series that is leaving soon", async () => {
    const asked = await television("The Expanse", "member");
    expect(leavingOf(asked.media)?.kind).toBe("leaving");
    expect(titleActions(asked.facts).primary).toBe("hold");
    // Somebody else asked for this one; the member may still hold it.
    const other = await television("Mr. Robot", "member");
    expect(other.facts.following).toBe(false);
    expect(titleActions(other.facts)).toEqual({
      primary: "hold",
      menu: ["request"],
    });
  });

  it("whoever asked for a removed series can bring it back", async () => {
    // The interest ran out, so the read no longer lists the request; it
    // still stands, and that is what restoring asks for.
    const { facts, media } = await television("Silo", "member");
    expect(leavingOf(media)?.kind).toBe("recoverable");
    expect(facts.following).toBe(false);
    expect(titleActions(facts).primary).toBe("restore");
  });
});

describe("where a reader stands with a film", () => {
  it("a member follows the featured film, which their request keeps for good", async () => {
    const { facts } = await film(FEATURED.movie.title, "member");
    expect(titleActions(facts)).toEqual({
      primary: "following",
      menu: ["request", "cancel_request"],
    });
  });

  it("a member can stop following a film that is still on its way", async () => {
    const { facts } = await film("Anora", "member");
    expect(titleActions(facts)).toEqual({
      primary: "following",
      menu: ["request", "hold", "stop_following"],
    });
  });

  it("a member who has not asked for a film can ask for it", async () => {
    const { facts } = await film("Interstellar", "member");
    expect(titleActions(facts)).toEqual({ primary: "request", menu: [] });
  });

  it("the owner keeps a film for good or just for now, and can pin it", async () => {
    const kept = await film("Interstellar", "owner");
    expect(titleActions(kept.facts)).toEqual({
      primary: "kept_for_good",
      menu: ["request", "keep_for_now", "pin"],
    });
    const pinned = await film("Dune", "owner");
    expect(titleActions(pinned.facts)).toEqual({
      primary: "kept_for_good",
      menu: ["request", "keep_for_now", "unpin"],
    });
    const temporary = await film("Alien", "owner");
    expect(temporary.media.libraryKeeping?.keepingPolicy).toBe("temporary");
    expect(titleActions(temporary.facts).primary).toBe("keep_for_good");
  });

  it("a film that is leaving soon can be held by a member", async () => {
    const { facts, media } = await film("Get Out", "member");
    expect(titleState(media, undefined, "en-US").tone).toBe("warn");
    expect(titleActions(facts).primary).toBe("hold");
  });

  it("the owner can bring a removed film back; a stranger cannot", async () => {
    const name = FEATURED.quarantinedMovie.title;
    const owner = await film(name, "owner");
    const stranger = await film(name, "member");
    expect(titleActions(owner.facts).primary).toBe("restore");
    expect(titleActions(stranger.facts).primary).toBe("request");
  });

  it("each version has its own standing, and only the standard one the title's", async () => {
    const standard = await film("Blade Runner", "owner");
    const finalCut = await film("Blade Runner", "owner", "final_cut");
    expect(standard.facts.following).toBe(false);
    expect(standard.facts.availability).toBe("available");
    expect(standard.facts.keeping).toBe("keep");
    expect(finalCut.facts.following).toBe(true);
    expect(finalCut.facts.availability).toBe("wanted");
    // Only the standard version takes part in removals and in keeping, and
    // only its request has an interest to let go.
    expect(finalCut.facts.leavingSoon).toBe(false);
    expect(finalCut.facts.keeping).toBeNull();
    expect(finalCut.facts.mayStopFollowing).toBe(false);
    expect(titleActions(finalCut.facts).menu).toContain("cancel_request");
  });
});

describe("what a title page says about its title", () => {
  it("a series says how much of it can be played", async () => {
    const { media } = await television("Severance", "member");
    expect(titleState(media)).toEqual({
      label: "16 of 19 episodes",
      tone: "progress",
    });
    expect(downloadProgress(media.visibility)).toBeCloseTo(0.63);
  });

  it("a film says where it is on its way in", async () => {
    const { media } = await film("Anora", "member");
    expect(titleState(media).label).toBe("Looking for it");
    expect(downloadProgress(media.visibility)).toBeNull();
  });

  it("a film and an episode have a runtime; a series and a season do not", async () => {
    const movie = await film(FEATURED.movie.title, "member");
    expect(movie.media.runtimeMinutes).toBeGreaterThan(0);
    const series = await television("Severance", "member");
    expect(series.media.runtimeMinutes).toBeNull();
  });
});

function followedBy(facts: readonly Fact[]): string | undefined {
  return facts.find((fact) => fact.term === "Followed by")?.detail;
}

describe("in your household", () => {
  it("names who follows a title, to the owner and to a member alike", async () => {
    for (const persona of ["owner", "member"] as const) {
      const { media, user, facts } = await television("Severance", persona);
      expect(
        followedBy(
          householdFacts(media, user, selfAsFollower(facts.following), "en-US"),
        ),
      ).toBe("You and Sam");
    }
  });

  it("lists one, two and many followers as a sentence does", async () => {
    const { media, user } = await television("Severance", "member");
    const sam = { displayName: "Sam", me: false };
    const kids = { displayName: "Kids", me: false };
    const me = { displayName: user.displayName, me: true };
    const said = (followers: typeof media.followers, self: string | null) =>
      followedBy(householdFacts({ ...media, followers }, user, self, "en-US"));
    expect(said([me], "You")).toBe("You");
    expect(said([sam], null)).toBe("Sam");
    expect(said([me, sam], "You")).toBe("You and Sam");
    expect(said([me, kids, sam], "You")).toBe("You, Kids, and Sam");
    expect(said([], null)).toBe("Nobody yet");
    // The reader's own name is never printed: they are "You".
    expect(said([me, sam], "You")).not.toContain(user.displayName);
  });

  it("says nothing about followers when the list is withheld", async () => {
    const { media, user } = await television("Severance", "member");
    const facts = householdFacts(
      { ...media, followers: null },
      user,
      "You",
      "en-US",
    );
    expect(followedBy(facts)).toBeUndefined();
    expect(JSON.stringify(facts)).not.toMatch(/nobody/iu);
    expect(facts[0]?.term).toBe("Keeping");
  });

  it("keeps the three ways of keeping apart, each under its own name", async () => {
    const follower = await television("Severance", "member");
    const facts = householdFacts(
      follower.media,
      follower.user,
      selfAsFollower(follower.facts.following),
      "en-US",
    );
    expect(facts.map((fact) => fact.term)).toEqual([
      "Followed by",
      "Keeping",
      "30-day hold",
      "Your subtitles",
    ]);
    expect(facts[1]?.detail).toBe(
      "Just for now: it stays while someone follows it",
    );
    expect(facts[2]?.detail).toMatch(/^Until [A-Z][a-z]{2} \d{1,2}, \d{4}$/u);
    expect(facts[3]?.detail).toBe("English");
    // A member has one of the three, so nothing explains how they relate.
    expect(householdNotes(follower.media, follower.user)).toEqual([]);

    const pinned = await television("Breaking Bad", "owner");
    expect(
      householdFacts(pinned.media, pinned.user, null, "en-US"),
    ).toContainEqual({ term: "Pin", detail: "Pinned, so it never leaves" });
    // The owner has all three, and one line says how they relate.
    expect(householdNotes(pinned.media, pinned.user)).toEqual([
      "Keeping is the library’s standing choice for this title. A 30-day hold and a pin protect it on top of that choice, and leave the choice as it is.",
    ]);
  });

  it("says whose request keeps a title for good when the switch does not", async () => {
    const { media, user } = await television("Bluey", "owner");
    const keeping = (detail: typeof media) =>
      householdFacts(detail, user, "You", "en-US").find(
        (fact) => fact.term === "Keeping",
      )?.detail;
    expect(keeping(media)).toBe("For good, because your request asks for that");
    const [own] = media.requests;
    if (own === undefined) throw new Error("The owner asked for Bluey");
    const sams = { ...own, userId: "sam", user: { displayName: "Sam" } };
    expect(keeping({ ...media, requests: [sams] })).toBe(
      "For good, because Sam’s request asks for that",
    );
    expect(keeping({ ...media, requests: [own, sams] })).toBe(
      "For good, because requests by you and Sam ask for that",
    );
    // With the switch on, the switch is the reason and needs no other.
    const switched = await television("Succession", "owner");
    expect(keeping(switched.media)).toBe(
      "For good: it stays even when nobody follows it",
    );
    // The owner is told how to let go a request that keeps the title.
    expect(householdNotes(media, user)[0]).toBe(
      "Your request keeps this for good, so Stop following is not offered. To let it go, first change the request to Keep just for now under Mine in the Library.",
    );
  });

  it("names the versions of a film a reader follows when not the standard one", async () => {
    const { media, user } = await film("Blade Runner", "member");
    expect(selfAsFollower(false, ["Final cut"])).toBeNull();
    expect(
      followedBy(
        householdFacts(media, user, selfAsFollower(true, ["Final cut"])),
      ),
    ).toBe("You (Final cut)");
  });

  it("says when a title leaves and until when it can come back", async () => {
    const leaving = await television("The Expanse", "member");
    expect(
      householdFacts(leaving.media, leaving.user, "You", "en-US").find(
        (fact) => fact.term === "Leaving",
      )?.detail,
    ).toMatch(/, unless someone keeps it$/u);
    const removed = await television("Silo", "member");
    expect(
      householdFacts(removed.media, removed.user, "You", "en-US").find(
        (fact) => fact.term === "Removed",
      )?.detail,
    ).toMatch(/^It can be restored until /u);
  });
});
