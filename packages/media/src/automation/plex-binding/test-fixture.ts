import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { PlexClient } from "#integrations/plex.ts";
import { rm } from "node:fs/promises";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";

let nextSyntheticItemId = 500;

/** Real PG/files publication; external Plex metadata is explicitly an injected fixture. */
export async function plexBindingFixture(
  db: Database,
  network: MediaAutomationContext,
  options: { publicationPending?: boolean } = {},
) {
  const files = await mappedPublicationFixture(db);
  try {
    const published =
      options.publicationPending === true
        ? await preparePhysicalPublication(files)
        : await files.published();
    const asset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: published.entry.assetId },
    });
    const calls: string[] = [];
    const ratingKey = String(nextSyntheticItemId++);
    const partId = nextSyntheticItemId++;
    const item = {
      ratingKey,
      type: "movie",
      title: files.media.title,
      Guid: [{ id: `tmdb://${String(files.media.tmdbId)}` }],
      Media: [
        {
          Part: [
            { id: partId, file: asset.path, size: Number(asset.sizeBytes) },
          ],
        },
      ],
    };
    const context: MediaAutomationContext = {
      ...network,
      plexAccess: (sectionType) =>
        Promise.resolve({
          serverMachineId: "fixture-server",
          sectionType,
          sectionId: sectionType === "movie" ? "1" : "2",
        }),
      plex: new PlexClient(
        {
          baseUrl: "http://plex.fixture",
          token: "synthetic",
          clientIdentifier: "synthetic",
        },
        (url) => {
          calls.push(url.pathname);
          if (url.pathname === "/identity") {
            return Promise.resolve(
              Response.json({
                MediaContainer: { machineIdentifier: "fixture-server" },
              }),
            );
          }
          if (url.pathname === "/library/sections/1/refresh")
            return Promise.resolve(new Response(null, { status: 200 }));
          if (url.pathname === "/library/sections") {
            return Promise.resolve(
              Response.json({
                MediaContainer: {
                  size: 1,
                  Directory: [{ key: "1", type: "movie", title: "Synthetic" }],
                },
              }),
            );
          }
          if (url.pathname === "/library/sections/1/all") {
            return Promise.resolve(
              Response.json({
                MediaContainer: { size: 1, totalSize: 1, Metadata: [item] },
              }),
            );
          }
          return url.pathname === `/library/metadata/${ratingKey}`
            ? Promise.resolve(
                Response.json({
                  MediaContainer: { size: 1, Metadata: [item] },
                }),
              )
            : Promise.reject(
                new Error(`Unexpected synthetic Plex request ${url.pathname}`),
              );
        },
      ),
    };
    return { files, published, asset, calls, item, context };
  } catch (error) {
    await rm(files.directory, { recursive: true, force: true });
    throw error;
  }
}

/** Real physical producer retaining the reservations required by subsequent Network publication. */
export async function preparePhysicalPublication(
  files: Awaited<ReturnType<typeof mappedPublicationFixture>>,
) {
  const acquired = await files.acquisition();
  const activities = createMediaFileActivities(files.context);
  const staged = await activities.inspectAndStageMedia(acquired.input);
  if (staged.status !== "staged")
    throw new Error(
      `Real pending publication failed to stage: ${JSON.stringify(staged)}`,
    );
  const promoted = await activities.promoteMediaFiles(acquired.input);
  if (promoted.status !== "published")
    throw new Error(
      `Real pending publication failed to promote: ${JSON.stringify(promoted)}`,
    );
  const attempt = await files.context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  const entry = FilePlanSchema.parse(attempt.filePlan)[0];
  if (entry === undefined)
    throw new Error("Real pending publication omitted its file");
  return { ...acquired, entry };
}

export function bindingTestExecution(): PlexBindingExecution {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const signal = new AbortController().signal;
  const assertActive = () => {
    signal.throwIfAborted();
    if (
      Date.now() >= observed.wall + 120_000 ||
      performance.now() >= observed.monotonic + 120_000
    ) {
      throw new Error("Synthetic binding SDK budget expired");
    }
  };
  return {
    observed,
    expiresAtMs: observed.wall + 60_000,
    signal,
    assertActive,
    checkpoint: () => {
      assertActive();
      return Promise.resolve();
    },
  };
}
