import { describe, expect, test } from "vitest";
import { PrismaPlexEventIngress } from "#infrastructure/plex-events/ingress.ts";
import { ObservePlexHintInputSchema } from "#shared/plex-events/contract.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { createPlexEventActivities } from "./activities.ts";
import { watchHarness, watchedTransport } from "./test-support.ts";

describe("Plex hints invoke authoritative current watch observation", () => {
  const h = watchHarness();
  async function queued() {
    const f = await h.fixture();
    await new PrismaPlexEventIngress(h.database(), {
      serverMachineId: "fixture-server",
      permittedSections: async () => ({ movie: "1", series: "2" }),
    }).accept({
      schemaVersion: 1,
      event: "media.scrobble",
      serverMachineId: "fixture-server",
      sectionId: "1",
      ratingKey: f.ratingKey,
      mediaKind: "movie",
    });
    const operation = await h.database().operation.findFirstOrThrow({
      where: { targetId: f.media.id, kind: "observe_plex_hint" },
    });
    return { ...f, input: ObservePlexHintInputSchema.parse(operation.payload) };
  }
  test("actual ingress operation observes scoped Plex and queues final own unwatched generation", async () => {
    const f = await queued();
    expect(
      await createPlexEventActivities(
        h.context(watchedTransport(false)),
        async () => true,
      ).observePlexEventHint(f.input),
    ).toEqual({ status: "observed", complete: true });
    expect(
      await h.database().operation.findFirst({
        where: { targetId: f.media.id, kind: "retain_media" },
      }),
    ).toMatchObject({ payload: { generation: 2, recoveryEpoch: 0 } });
    expect(
      await h.database().watchObservationFence.findUnique({
        where: { mediaId_edition: defaultScope(f.media.id) },
      }),
    ).toMatchObject({ settledRevision: 1n });
    expect(
      await createPlexEventActivities(
        h.context(),
        async () => true,
      ).observePlexEventHint(f.input),
    ).toEqual({ status: "superseded", complete: false });
  });
  test.each(["epoch", "generation", "ambiguity", "operation"])(
    "queued hint becomes inert after %s changes",
    async (change) => {
      const f = await queued();
      const db = h.database();
      if (change === "epoch")
        await db.mediaRuntimeState.update({
          where: { id: "singleton" },
          data: { recoveryEpoch: 1 },
        });
      if (change === "generation")
        await db.mediaIntent.update({
          where: { mediaId_edition: defaultScope(f.media.id) },
          data: { generation: { increment: 1 } },
        });
      if (change === "ambiguity")
        await db.mediaItem.create({
          data: {
            kind: "movie",
            title: "Collision",
            externalIds: { plexSectionId: "1", plexRatingKey: f.ratingKey },
          },
        });
      const input =
        change === "operation"
          ? { ...f.input, operationId: crypto.randomUUID() }
          : f.input;
      expect(
        await createPlexEventActivities(
          h.context(),
          async () => true,
        ).observePlexEventHint(input),
      ).toEqual({ status: "superseded", complete: false });
      expect(
        await db.watchState.findUnique({
          where: { userId_mediaId_edition: f.key },
        }),
      ).toMatchObject({ observedAt: new Date(0) });
      expect(
        await db.watchObservationFence.count({
          where: { mediaId: f.media.id },
        }),
      ).toBe(0);
    },
  );
  test("disabled hint allocates no fence and reads no Plex metadata", async () => {
    const f = await queued();
    let flags = 0;
    expect(
      await createPlexEventActivities(h.context(), async () => {
        flags++;
        return false;
      }).observePlexEventHint(f.input),
    ).toEqual({ status: "disabled", complete: false });
    expect(flags).toBe(1);
    expect(
      await h
        .database()
        .watchObservationFence.count({ where: { mediaId: f.media.id } }),
    ).toBe(0);
  });
});
