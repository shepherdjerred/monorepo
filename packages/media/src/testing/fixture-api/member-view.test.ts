import { describe, expect, it } from "vitest";
import {
  CatalogDetailSchema,
  MediaDetailSchema,
  ProfileDefaultsSchema,
  ProfileListSchema,
  ReleaseListSchema,
} from "#shared/api.ts";
import { RequestInterestListSchema } from "#shared/household/interests.ts";
import { LibraryPageSchema } from "#shared/household/library.ts";
import { MovieTargetContextV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { FEATURED, episodeId, seasonId } from "./fixtures/titles.ts";
import { KIDS, MEMBER, OWNER, SAM } from "./personas.ts";
import type { Persona } from "./personas.ts";
import { routeFixture } from "./router.ts";

/** The body as a browser receives it: serialized, then read back. */
async function read(
  path: string,
  persona: Persona,
  version = 1,
): Promise<unknown> {
  const outcome = routeFixture({
    method: "GET",
    url: new URL(`http://fixture.invalid/api/v${String(version)}${path}`),
    persona,
  });
  if (outcome.status !== 200) {
    throw new Error(`${persona} ${path}: HTTP ${String(outcome.status)}`);
  }
  return Response.json(outcome.body).json();
}

const TITLES = [FEATURED.movie, FEATURED.series, FEATURED.quarantinedMovie].map(
  (title) => ({ name: title.title, id: title.id }),
);

const MOVIES = [FEATURED.movie, FEATURED.quarantinedMovie].map((title) => ({
  name: title.title,
  id: title.id,
}));

describe("what a member reads, as the server projects it", () => {
  it.each(TITLES)(
    "$name: download progress without acquisition detail",
    async ({ id }) => {
      const owner = MediaDetailSchema.parse(
        await read(`/media/${id}`, "owner"),
      );
      const member = MediaDetailSchema.parse(
        await read(`/media/${id}`, "member"),
      );
      expect(owner.visibility.attempts.length).toBeGreaterThan(0);
      expect(owner.visibility.torrents.length).toBeGreaterThan(0);
      expect(owner.intent?.profileId).toEqual(expect.any(String));
      expect(member.visibility.attempts).toEqual([]);
      expect(member.intent).toEqual({ ...owner.intent, profileId: null });
      expect(member.subtitlePolicies).toEqual([]);
      expect(member.visibility.torrents).toEqual(
        owner.visibility.torrents.map((torrent) => ({
          id: torrent.id,
          state: torrent.state,
          freshness: torrent.freshness,
          progress: torrent.progress,
          observedAt: null,
          ratio: null,
          seededSeconds: null,
          diagnostics: null,
        })),
      );
      expect(member.visibility.playback).toEqual(owner.visibility.playback);
    },
  );

  it("the owner keeps subtitle policies and seeding figures", async () => {
    const owner = MediaDetailSchema.parse(
      await read(`/media/${FEATURED.movie.id}`, "owner"),
    );
    expect(owner.subtitlePolicies.length).toBeGreaterThan(0);
    expect(
      owner.visibility.torrents.some((torrent) => torrent.ratio !== null),
    ).toBe(true);
  });

  it.each(TITLES)(
    "$name: release candidates only for the owner",
    async ({ id }) => {
      const owner = ReleaseListSchema.parse(
        await read(`/media/${id}/releases`, "owner"),
      );
      expect(owner.length).toBeGreaterThan(0);
      expect(await read(`/media/${id}/releases`, "member")).toEqual([]);
    },
  );

  it.each(MOVIES)(
    "$name: its unmarked edition's transfer without acquisition detail",
    async ({ id }) => {
      const path = `/media/${id}/movie-editions/default`;
      const owner = MovieTargetContextV4Schema.parse(
        await read(path, "owner", 4),
      );
      const member = MovieTargetContextV4Schema.parse(
        await read(path, "member", 4),
      );
      if (owner.access !== "detail" || member.access !== "detail") {
        throw new Error(`${path} lost its detail access`);
      }
      expect(owner.progress?.attempts.length).toBeGreaterThan(0);
      expect(owner.progress?.torrents.length).toBeGreaterThan(0);
      expect(member.progress).toEqual({
        attempts: [],
        torrents: owner.progress?.torrents.map((torrent) => ({
          id: torrent.id,
          state: torrent.state,
          freshness: torrent.freshness,
          progress: torrent.progress,
          observedAt: null,
          ratio: null,
          seededSeconds: null,
          diagnostics: null,
        })),
        historyTruncated: owner.progress?.historyTruncated,
      });
      expect(member.currentAsset).toEqual(owner.currentAsset);
    },
  );

  it("the owner keeps an edition's attempts and seeding figures", async () => {
    const owner = MovieTargetContextV4Schema.parse(
      await read(
        `/media/${FEATURED.movie.id}/movie-editions/default`,
        "owner",
        4,
      ),
    );
    if (owner.access !== "detail") {
      throw new Error("The featured movie lost its detail access");
    }
    expect(
      owner.progress?.torrents.some((torrent) => torrent.ratio !== null),
    ).toBe(true);
  });

  it("quality profiles only for the owner, as an empty list for a member", async () => {
    const owner = ProfileListSchema.parse(await read("/profiles", "owner"));
    expect(owner.length).toBeGreaterThan(0);
    expect(await read("/profiles", "member")).toEqual([]);
  });

  it("profile defaults only for the owner, refused for a member", async () => {
    const owner = ProfileDefaultsSchema.parse(
      await read("/profile-defaults", "owner"),
    );
    expect(owner.length).toBeGreaterThan(0);
    const refused = routeFixture({
      method: "GET",
      url: new URL("http://fixture.invalid/api/v1/profile-defaults"),
      persona: "member",
    });
    expect(refused.status).toBe(403);
  });
});

describe("what a title page reads about keeping and following", () => {
  it.each(["owner", "member"] as const)(
    "%s: a title page reports the keeping its library item reports, a season and an episode their series'",
    async (persona) => {
      const library = LibraryPageSchema.parse(
        await read("/library?limit=50", persona),
      );
      const policies = new Set<string>();
      for (const item of library.items) {
        const detail = MediaDetailSchema.parse(
          await read(`/media/${item.id}`, persona),
        );
        expect(detail.policy).toBe(item.policy);
        expect(detail.libraryKeeping).toEqual(item.libraryKeeping);
        policies.add(item.policy);
      }
      expect([...policies].sort()).toEqual([
        "keep",
        "temporary",
        "unclassified",
      ]);
      expect(library.items.some((item) => item.libraryKeeping !== null)).toBe(
        persona === "owner",
      );
      const series = MediaDetailSchema.parse(
        await read(`/media/${FEATURED.series.id}`, persona),
      );
      for (const id of [
        seasonId(FEATURED.series, 1),
        episodeId(FEATURED.series, 1, 3),
      ]) {
        const part = MediaDetailSchema.parse(
          await read(`/media/${id}`, persona),
        );
        expect(part.rootMediaId).toBe(FEATURED.series.id);
        expect(part.policy).toBe(series.policy);
        expect(part.libraryKeeping).toEqual(series.libraryKeeping);
      }
    },
  );

  it("each request carries the interest the interests read reports, and a spread row carries none", async () => {
    const interests = RequestInterestListSchema.parse(
      await read("/request-interests", "member"),
    );
    // The first interests page. A title page lists the requests that still
    // follow their title, as the server's read does: an interest that was let
    // go or ran out is on the interests list alone.
    const states = new Map<string, number>();
    for (const interest of interests.items) {
      const detail = MediaDetailSchema.parse(
        await read(`/media/${interest.mediaId}`, "member"),
      );
      const request = detail.requests.find(
        (entry) => entry.id === interest.requestId,
      );
      states.set(
        interest.interestState,
        (states.get(interest.interestState) ?? 0) + 1,
      );
      if (interest.interestState !== "following") {
        expect(request).toBeUndefined();
        continue;
      }
      expect(request).toMatchObject({
        version: interest.version,
        interestRevision: interest.interestRevision,
        interestState: "following",
        keepingPolicy: interest.keepingPolicy,
      });
    }
    expect([...states.keys()].sort()).toEqual([
      "dropped",
      "expired",
      "finished",
      "following",
    ]);
    const episode = MediaDetailSchema.parse(
      await read(`/media/${episodeId(FEATURED.series, 1, 3)}`, "member"),
    );
    expect(episode.requests).toEqual([
      expect.objectContaining({
        userId: MEMBER.id,
        interestRevision: null,
        interestState: null,
        keepingPolicy: null,
      }),
    ]);
  });

  it.each(TITLES)(
    "$name: a member reads only their own requests",
    async ({ id }) => {
      const owner = MediaDetailSchema.parse(
        await read(`/media/${id}`, "owner"),
      );
      const member = MediaDetailSchema.parse(
        await read(`/media/${id}`, "member"),
      );
      expect(
        member.requests.every((request) => request.userId === MEMBER.id),
      ).toBe(true);
      expect(owner.requests.length).toBeGreaterThanOrEqual(
        member.requests.length,
      );
    },
  );
});

describe("what a title page reads about its runtime and its followers", () => {
  it.each([
    { persona: "owner", reader: OWNER },
    { persona: "member", reader: MEMBER },
  ] as const)(
    "$persona: followers are names only, the reader first, and agree with the reader's own request",
    async ({ persona, reader }) => {
      const library = LibraryPageSchema.parse(
        await read("/library?limit=50", persona),
      );
      let withReader = 0;
      for (const item of library.items) {
        const detail = MediaDetailSchema.parse(
          await read(`/media/${item.id}`, persona),
        );
        const followers = detail.followers ?? [];
        expect(detail.followers).not.toBeNull();
        for (const follower of followers)
          expect(Object.keys(follower).sort()).toEqual(["displayName", "me"]);
        const mine = followers.filter((follower) => follower.me);
        expect(mine.length).toBeLessThanOrEqual(1);
        const follows = detail.requests.some(
          (request) =>
            request.userId === reader.id &&
            request.interestState === "following",
        );
        expect(mine.length === 1).toBe(follows);
        if (follows) {
          expect(followers[0]).toEqual({
            displayName: reader.displayName,
            me: true,
          });
          withReader += 1;
        }
        // A title the library holds only while followed has a follower.
        if (item.policy === "temporary")
          expect(followers.length).toBeGreaterThan(0);
      }
      expect(withReader).toBeGreaterThan(0);
    },
  );

  it("a member reads the names of the others who follow a title, and a managed profile's own name", async () => {
    const movie = MediaDetailSchema.parse(
      await read(`/media/${FEATURED.movie.id}`, "member"),
    );
    expect(movie.followers).toContainEqual({
      displayName: SAM.displayName,
      me: false,
    });
    // The member's `requests` still holds only their own.
    expect(
      movie.requests.every((request) => request.userId === MEMBER.id),
    ).toBe(true);
    const managed = MediaDetailSchema.parse(
      await read(`/media/${FEATURED.protectionOnly.id}`, "member"),
    );
    expect(managed.followers).toContainEqual({
      displayName: KIDS.displayName,
      me: false,
    });
  });

  it("a season and an episode report their series' followers, and their own runtime", async () => {
    const series = MediaDetailSchema.parse(
      await read(`/media/${FEATURED.series.id}`, "member"),
    );
    const season = MediaDetailSchema.parse(
      await read(`/media/${seasonId(FEATURED.series, 1)}`, "member"),
    );
    const episode = MediaDetailSchema.parse(
      await read(`/media/${episodeId(FEATURED.series, 1, 3)}`, "member"),
    );
    expect(series.followers?.length).toBeGreaterThan(0);
    expect(season.followers).toEqual(series.followers);
    expect(episode.followers).toEqual(series.followers);
    // A series and a season have no runtime of their own; an episode does.
    expect(series.runtimeMinutes).toBeNull();
    expect(season.runtimeMinutes).toBeNull();
    expect(episode.runtimeMinutes).toEqual(expect.any(Number));
  });

  it("a film's title page and its catalog page report the same runtime, and a series' catalog page none", async () => {
    const library = LibraryPageSchema.parse(
      await read("/library?limit=50&kind=movie", "member"),
    );
    const runtimes = new Set<string>();
    for (const item of library.items) {
      const detail = MediaDetailSchema.parse(
        await read(`/media/${item.id}`, "member"),
      );
      if (detail.catalog === null)
        throw new Error(`${item.title} has no catalog page`);
      const catalog = CatalogDetailSchema.parse(
        await read(
          `/catalog/movie/${String(detail.catalog.externalId)}`,
          "member",
        ),
      );
      expect(catalog.runtimeMinutes).toBe(detail.runtimeMinutes);
      runtimes.add(detail.runtimeMinutes === null ? "unknown" : "known");
    }
    expect([...runtimes].sort()).toEqual(["known", "unknown"]);
    const series = MediaDetailSchema.parse(
      await read(`/media/${FEATURED.series.id}`, "member"),
    );
    if (series.catalog === null)
      throw new Error("The featured series has no catalog page");
    const catalog = CatalogDetailSchema.parse(
      await read(
        `/catalog/series/${String(series.catalog.externalId)}`,
        "member",
      ),
    );
    expect(catalog.runtimeMinutes).toBeNull();
  });
});
