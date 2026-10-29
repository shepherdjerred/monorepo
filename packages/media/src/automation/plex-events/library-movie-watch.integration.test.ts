import { afterEach, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { libraryBindingFixture } from "#automation/plex-binding/library.test-fixture.ts";
import { verifyLibraryPlexBinding } from "#automation/plex-binding/library.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { LibraryPlexBindingInputV1Schema } from "#shared/plex-binding/activities.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import { PlexClient } from "#integrations/plex.ts";

const h = automationTestHarness();
const directories: string[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test.each(MovieEditionKeySchema.options)(
  "an adopted %s movie observes its real requester's exact watch without constructing acquisition history",
  async (edition) => {
    const db = h.database();
    const f = await libraryBindingFixture(
      db,
      edition,
      (directory) => {
        directories.push(directory);
      },
      { bytes },
    );
    const requester = await h.fixture();
    const mediaId = f.network.media.id;
    await requestTestMovieV4(db, requester.user, mediaId, edition);
    await db.credential.create({
      data: {
        userId: requester.user.id,
        kind: "plex",
        ciphertext: f.context.cipher.encrypt(
          JSON.stringify({ serverToken: "synthetic-adopted-requester" }),
          `plex:${requester.user.plexAccountId}`,
        ),
      },
    });
    const operation = await db.operation.findUniqueOrThrow({
      where: { idempotencyKey: `library-plex:${f.receiptId}:${f.asset.id}:0` },
    });
    expect(
      await verifyLibraryPlexBinding(
        f.context,
        LibraryPlexBindingInputV1Schema.parse(operation.payload),
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "verified", bindingCount: 1 });
    const item = f.item();
    const context = {
      ...f.context,
      userPlex: (token: string) => {
        expect(token).toBe("synthetic-adopted-requester");
        return new PlexClient(
          {
            baseUrl: "http://plex.fixture",
            token,
            clientIdentifier: "synthetic-watch",
          },
          (url) => {
            if (url.pathname !== `/library/metadata/${item.ratingKey}`)
              throw new Error(
                "Adopted watch escaped its exact current binding",
              );
            return Promise.resolve(
              Response.json({ MediaContainer: { size: 1, Metadata: [item] } }),
            );
          },
        );
      },
    };
    const sweeps = createSweepActivities(context);
    let cursor: string | null = null;
    do {
      const result = await sweeps.sweepMediaWork({
        kind: "watch",
        cursor,
        sweepId: "synthetic-adopted-watch",
      });
      cursor = result.nextCursor;
    } while (cursor !== null);
    expect(
      await db.watchState.findUniqueOrThrow({
        where: {
          userId_mediaId_edition: {
            userId: requester.user.id,
            mediaId,
            edition,
          },
        },
      }),
    ).toMatchObject({ watched: true, source: "plex_current" });
    expect(
      await db.acquisitionAttempt.count({
        where: { mediaIds: { has: mediaId } },
      }),
    ).toBe(0);
    expect(await db.torrent.count()).toBe(0);
  },
);
