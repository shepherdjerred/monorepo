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
  televisionFacts,
  versionFacts,
} from "#client/title/facts.ts";
import { householdFacts, selfAsFollower } from "#client/title/household.tsx";
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
  it("a member who follows it can stop, and hold it", async () => {
    const { facts, context, user } = await television("Severance", "member");
    expect(facts.following).toBe(true);
    expect(facts.canCancel).toBe(true);
    expect(cancellableRequest(context, user)?.active).toBe(true);
    expect(titleActions(facts)).toEqual({
      primary: "following",
      menu: ["hold", "cancel_request"],
    });
  });

  it("a member who does not follow it can only ask for it", async () => {
    const { facts } = await television("Succession", "member");
    expect(titleActions(facts)).toEqual({ primary: "request", menu: [] });
  });

  it("the owner can hold a series the household can watch, or pin it", async () => {
    const { facts } = await television("Succession", "owner");
    expect(titleActions(facts)).toEqual({
      primary: "hold",
      menu: ["request", "pin"],
    });
  });

  it("the owner who pinned one can take the pin off", async () => {
    const { facts } = await television("Breaking Bad", "owner");
    expect(titleActions(facts)).toEqual({
      primary: "request",
      menu: ["unpin"],
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
    const { facts, media } = await television("Silo", "member");
    expect(leavingOf(media)?.kind).toBe("recoverable");
    expect(titleActions(facts).primary).toBe("restore");
  });
});

describe("where a reader stands with a film", () => {
  it("a member follows the featured film and can stop", async () => {
    const { facts } = await film(FEATURED.movie.title, "member");
    expect(titleActions(facts)).toEqual({
      primary: "following",
      menu: ["request", "hold", "cancel_request"],
    });
  });

  it("a member who has not asked for a film can ask for it", async () => {
    const { facts } = await film("Interstellar", "member");
    expect(titleActions(facts)).toEqual({ primary: "request", menu: [] });
  });

  it("the owner can hold or pin a film, and take a pin off", async () => {
    const free = await film("Interstellar", "owner");
    expect(titleActions(free.facts)).toEqual({
      primary: "hold",
      menu: ["request", "pin"],
    });
    const pinned = await film("Dune", "owner");
    expect(titleActions(pinned.facts)).toEqual({
      primary: "request",
      menu: ["unpin"],
    });
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

  it("each version has its own standing", async () => {
    const standard = await film("Blade Runner", "member");
    const finalCut = await film("Blade Runner", "member", "final_cut");
    expect(standard.facts.following).toBe(false);
    expect(standard.facts.availability).toBe("available");
    expect(finalCut.facts.following).toBe(true);
    expect(finalCut.facts.availability).toBe("wanted");
    // Only the standard version takes part in removals.
    expect(finalCut.facts.leavingSoon).toBe(false);
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
});

describe("in your household", () => {
  it("tells the owner who follows a title, by name", async () => {
    const { media, user, facts } = await television("Severance", "owner");
    expect(
      householdFacts(media, user, selfAsFollower(facts.following), "en-US")[0],
    ).toEqual({
      term: "Following",
      detail: "You, Sam",
    });
  });

  it("tells a member only about themselves", async () => {
    const follower = await television("Severance", "member");
    const facts = householdFacts(
      follower.media,
      follower.user,
      selfAsFollower(follower.facts.following),
      "en-US",
    );
    expect(facts.map((fact) => fact.term)).toEqual([
      "Following",
      "Keeping",
      "Your subtitles",
    ]);
    expect(facts[0]?.detail).toBe("You");
    expect(facts[1]?.detail).toMatch(
      /^Kept until [A-Z][a-z]{2} \d{1,2}, \d{4}$/u,
    );
    expect(facts[2]?.detail).toBe("English");
    expect(JSON.stringify(facts)).not.toContain("Sam");

    const stranger = await television("Succession", "member");
    expect(
      householdFacts(stranger.media, stranger.user, null, "en-US"),
    ).toEqual([{ term: "Following", detail: "You are not following this" }]);
  });

  it("names the versions of a film a reader follows when not the standard one", async () => {
    const { media, user } = await film("Blade Runner", "member");
    expect(selfAsFollower(false, ["Final cut"])).toBeNull();
    expect(
      householdFacts(media, user, selfAsFollower(true, ["Final cut"]))[0],
    ).toEqual({ term: "Following", detail: "You (Final cut)" });
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

  it("says the owner pinned a title, in the pin's own words", async () => {
    const { media, user } = await television("Breaking Bad", "owner");
    expect(householdFacts(media, user, null, "en-US")).toContainEqual({
      term: "Keeping",
      detail: "Pinned, so it never leaves",
    });
  });
});
