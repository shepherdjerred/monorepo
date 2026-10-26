import { automationTestHarness } from "#testing/automation.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import type { FetchTransport } from "#integrations/http.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { afterAll } from "vitest";
import { rm } from "node:fs/promises";
import {
  plexBindingFixture,
  bindingTestExecution,
} from "#automation/plex-binding/test-fixture.ts";
import { queueExistingPlexBinding } from "#automation/plex-binding/queue.ts";
import { reverifyPlexBinding } from "#automation/plex-binding/reverify.ts";
import { ReverifyPlexBindingInputSchema } from "#shared/plex-binding/activities.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { observeRequesterWatch } from "#automation/watch.ts";
import type { PlexItem } from "#integrations/plex.ts";

const syntheticItems = new Map<string, PlexItem>();

export function watchHarness() {
  const harness = automationTestHarness();
  const owned: { directory: string; ratingKey: string }[] = [];
  afterAll(async () => {
    for (const resource of owned) {
      syntheticItems.delete(resource.ratingKey);
      await rm(resource.directory, { recursive: true, force: true });
    }
  });
  const context = (transport: FetchTransport = watchedTransport(true)) =>
    harness.context(transport);
  async function credential(user: { id: string; plexAccountId: string }) {
    return await harness.database().credential.create({
      data: {
        userId: user.id,
        kind: "plex",
        ciphertext: harness.cipher.encrypt(
          JSON.stringify({ serverToken: user.id }),
          `plex:${user.plexAccountId}`,
        ),
      },
    });
  }
  async function fixture() {
    const produced = await plexBindingFixture(
      harness.database(),
      harness.context(),
      { publicationPending: true },
    );
    const ratingKey = produced.item.ratingKey;
    owned.push({ directory: produced.files.directory, ratingKey });
    const publication = createPublicationActivities(produced.context);
    const published = await publication.publishMediaToPlex(
      produced.published.input,
    );
    if (published.status !== "available")
      throw new Error("Actual watch fixture failed Network publication");
    await publication.finalizeMediaAcquisition(produced.published.input);
    syntheticItems.set(ratingKey, produced.item);
    const { user, media } = produced.files;
    const token = await credential(user);
    const key = { userId: user.id, ...defaultScope(media.id) };
    const initialObservation = await observeRequesterWatch(context(), media.id);
    if (!initialObservation.complete)
      throw new Error(
        "Actual watch fixture failed its initial bound observation",
      );
    const baseline = await harness
      .database()
      .watchState.findUniqueOrThrow({ where: { userId_mediaId_edition: key } });
    const fence = await harness
      .database()
      .watchObservationFence.findUniqueOrThrow({
        where: { mediaId_edition: defaultScope(media.id) },
      });
    const rebind = async () => {
      const queued = await queueExistingPlexBinding(
        produced.context,
        produced.asset.id,
      );
      if (queued.status !== "queued")
        throw new Error(
          "Actual watch fixture failed to queue replacement binding",
        );
      const operation = await harness
        .database()
        .operation.findUniqueOrThrow({ where: { id: queued.operationId } });
      const result = await reverifyPlexBinding(
        produced.context,
        ReverifyPlexBindingInputSchema.parse(operation.payload),
        bindingTestExecution(),
      );
      if (result.status !== "verified")
        throw new Error(
          "Actual watch fixture failed replacement binding verification",
        );
    };
    return {
      ...produced.files,
      ratingKey,
      token,
      key,
      baseline,
      fence,
      item: produced.item,
      asset: produced.asset,
      rebind,
    };
  }
  async function requester(mediaId: string) {
    const user = await harness.database().mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Second requester",
      },
    });
    await grantTestRequesterAccess(
      harness.database(),
      user.id,
      "fixture-server",
    );
    await credential(user);
    await harness
      .database()
      .mediaRequest.create({ data: { userId: user.id, mediaId } });
    const initialObservation = await observeRequesterWatch(context(), mediaId);
    if (!initialObservation.complete)
      throw new Error(
        "Actual added requester failed its initial bound observation",
      );
    return user;
  }
  return { ...harness, context, fixture, requester };
}

export function watchedTransport(watched: boolean): FetchTransport {
  return (url) => {
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
            Directory: [
              { key: "1", type: "movie", title: "Synthetic movie library" },
            ],
          },
        }),
      );
    const item = syntheticItems.get(url.pathname.split("/").at(-1) ?? "");
    if (item === undefined)
      return Promise.reject(
        new Error("No actual bound fixture item for this request"),
      );
    return Promise.resolve(
      Response.json({
        MediaContainer: {
          size: 1,
          Metadata: [
            {
              ...item,
              viewCount: watched ? 1 : 0,
            },
          ],
        },
      }),
    );
  };
}

function uninitialized(): never {
  throw new Error("Barrier is uninitialized");
}
export function barrier() {
  let release: () => void = uninitialized;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

export function pausedTransport(transport: FetchTransport) {
  const entered = barrier();
  const resume = barrier();
  return {
    entered: entered.promise,
    resume: resume.release,
    transport: async (...args: Parameters<FetchTransport>) => {
      entered.release();
      await resume.promise;
      return await transport(...args);
    },
  };
}
