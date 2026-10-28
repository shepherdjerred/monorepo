import { expect } from "vitest";
import { moviePlexV4Fixture } from "#testing/movie-plex-v4.ts";
import type { automationTestHarness } from "#testing/automation.ts";
import { publishMoviePlexV4 } from "#automation/movie-editions/plex-publication.ts";
import { finalizeMovieAcquisitionV4 } from "#automation/movie-editions/finalization.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import type { PlexItem } from "#integrations/plex.ts";

export async function publishedWatchQueueFixture(
  h: ReturnType<typeof automationTestHarness>,
  bytes: Uint8Array,
  edition: MovieEditionKey,
  items: Map<string, PlexItem>,
) {
  const base = await h.fixture();
  const f = await moviePlexV4Fixture(h.database(), h.context(), base, {
    bytes,
    edition,
  });
  expect(
    await publishMoviePlexV4(f.network, f.input, testPlexBindingExecution()),
  ).toEqual({ status: "available", reason: null });
  await finalizeMovieAcquisitionV4(
    f.network,
    f.input,
    testPlexBindingExecution(),
  );
  items.set(f.item.ratingKey, f.item);
  await h.database().credential.create({
    data: {
      userId: base.user.id,
      kind: "plex",
      ciphertext: h.cipher.encrypt(
        JSON.stringify({ serverToken: "synthetic-requester" }),
        `plex:${base.user.plexAccountId}`,
      ),
    },
  });
  const requester = h.context((url, init) => {
    expect(new Headers(init.headers).get("X-Plex-Token")).toBe(
      "synthetic-requester",
    );
    if (url.pathname === "/identity")
      return Promise.resolve(
        Response.json({
          MediaContainer: { machineIdentifier: "fixture-server" },
        }),
      );
    if (url.pathname === "/library/sections")
      return Promise.resolve(
        Response.json({
          MediaContainer: {
            size: 1,
            Directory: [{ key: "1", type: "movie", title: "Movies" }],
          },
        }),
      );
    const item = items.get(url.pathname.slice("/library/metadata/".length));
    if (item === undefined || !url.pathname.startsWith("/library/metadata/"))
      throw new Error("Watch escaped actual fixture bindings");
    return Promise.resolve(
      Response.json({
        MediaContainer: { size: 1, Metadata: [{ ...item, viewCount: 1 }] },
      }),
    );
  });
  return {
    ...f,
    context: { ...f.network, userPlex: requester.userPlex },
    scope: f.input.scope,
    base,
  };
}
