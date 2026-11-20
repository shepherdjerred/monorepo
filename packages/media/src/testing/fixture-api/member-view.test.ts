import { describe, expect, it } from "vitest";
import { MediaDetailSchema, ReleaseListSchema } from "#shared/api.ts";
import { FEATURED } from "./fixtures/titles.ts";
import type { Persona } from "./personas.ts";
import { routeFixture } from "./router.ts";

/** The body as a browser receives it: serialized, then read back. */
async function read(path: string, persona: Persona): Promise<unknown> {
  const outcome = routeFixture({
    method: "GET",
    url: new URL(`http://fixture.invalid/api/v1${path}`),
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
});
