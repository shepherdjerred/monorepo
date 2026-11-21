import { describe, expect, it } from "vitest";
import {
  MediaDetailSchema,
  ProfileDefaultsSchema,
  ProfileListSchema,
  ReleaseListSchema,
} from "#shared/api.ts";
import { MovieTargetContextV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { FEATURED } from "./fixtures/titles.ts";
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
