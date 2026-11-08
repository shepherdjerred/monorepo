import { afterEach, beforeAll, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createRestoredMovieFixture } from "#testing/movie-workflow/restore-fixture.ts";
import { movieWorkflowWire } from "#testing/movie-workflow/wire.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { MovieRestorePlexReceiptEnvelopeV1Schema } from "#shared/movie-editions/restore-plex-v1.ts";
import { PlexMovieAssociationV2Schema } from "#shared/plex-binding/contract.ts";
import { warningHistory } from "#automation/retention/fixtures/elapsed.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { publishRestoredMovieToPlexV4 } from "./restore-plex.ts";

const closers: (() => Promise<void>)[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
type Fixture = Awaited<ReturnType<typeof createRestoredMovieFixture>>;

async function ready(
  edition: (typeof MovieEditionKeySchema.options)[number],
  sibling = false,
) {
  const f = await createRestoredMovieFixture(edition, bytes, { sibling });
  closers.push(f.close);
  return f;
}

function invocation(f: Fixture) {
  const execution = testPlexBindingExecution();
  const budget = new PublicationAuthorityReadBudget();
  return {
    execution,
    budget,
    context: {
      ...f.context,
      permittedSections: () => f.context.permittedSections(),
      plexBindingExecution: () => execution,
      movieManagement: { execution, budget },
    },
  };
}

async function state(f: Fixture) {
  const restore = await f.db.operation.findUniqueOrThrow({
    where: { id: f.input.operationId },
  });
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
    include: { subtitles: { orderBy: { id: "asc" } } },
  });
  const installed = asset.subtitles.filter(
    (subtitle) =>
      subtitle.state === "installed" && subtitle.storageKind === "sidecar",
  );
  expect(installed.map((subtitle) => subtitle.language).sort()).toEqual([
    "en",
    "zh-Hans",
  ]);
  const files = [
    asset.path,
    ...installed.map((subtitle) => {
      if (subtitle.path === null)
        throw new Error("Actual restored caption lost its library path");
      return subtitle.path;
    }),
  ];
  return {
    asset,
    bytes: await Promise.all(
      files.map((filename) =>
        readFile(workerFilePath(f.source.files.context, filename)),
      ),
    ),
    physical: z
      .object({ movieRestoreReceiptV1: z.unknown() })
      .parse(restore.result).movieRestoreReceiptV1,
    quarantine: await f.db.operation.findUniqueOrThrow({
      where: { id: f.retentionInput.operationId },
    }),
    publication: await f.db.operation.findUniqueOrThrow({
      where: { id: f.publicationOperationId },
    }),
    originalAssociation: await f.db.plexAssociationEvidence.findUniqueOrThrow({
      where: { id: f.initialAssociation.id },
    }),
    history: await warningHistory(f.db, f.decisionId),
    attempts: await f.db.acquisitionAttempt.findMany({
      where: { mediaIds: { has: f.scope.mediaId } },
      orderBy: { id: "asc" },
    }),
    torrents: await f.db.torrent.findMany({ orderBy: { id: "asc" } }),
  };
}

async function siblingState(f: Fixture) {
  if (f.siblingEdition === null) return null;
  const where = { mediaId: f.scope.mediaId, edition: f.siblingEdition };
  return {
    target: await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: where },
    }),
    requests: await f.db.mediaRequest.findMany({ where }),
    holds: await f.db.retentionHold.findMany({ where }),
  };
}

async function bindingState(f: Fixture) {
  const scope = { mediaId: f.scope.mediaId, edition: f.scope.edition };
  return {
    pointer: await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: { mediaId_edition: scope },
    }),
    associations: await f.db.plexAssociationEvidence.findMany({
      where: scope,
      orderBy: { id: "asc" },
    }),
    groups: await f.db.plexClaimGroup.findMany({
      where: { group: { path: ["assetId"], equals: f.asset.id } },
      include: {
        members: { include: { item: true } },
        parts: true,
        paths: true,
      },
    }),
  };
}

async function assertImmutableCompletion(f: Fixture, command: unknown) {
  await expect(
    f.db
      .$executeRaw`UPDATE "Operation" SET result=result-'movieRestorePlexReceiptV1' WHERE id=${f.input.operationId}`,
  ).rejects.toThrow("immutable");
  await expect(
    f.db
      .$executeRaw`UPDATE "Operation" SET payload=jsonb_set(payload,'{scope,edition}','"extended_cut"'::jsonb) WHERE id=${f.input.operationId}`,
  ).rejects.toThrow("immutable");
  expect(
    await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    }),
  ).toEqual(command);
}

test.each(MovieEditionKeySchema.options)(
  "%s rebinds the actual restored movie at the same Plex item and Part after two real inventory passes",
  async (edition) => {
    const f = await ready(edition, true);
    const before = await state(f);
    const sibling = await siblingState(f);
    const watchBefore = await f.context
      .userPlex("synthetic-requester")
      .metadata(f.source.wire.ratingKey);
    let metadataReads = 0;
    f.source.wire.control.beforeMetadata = () => {
      metadataReads++;
      return Promise.resolve();
    };
    const call = invocation(f);
    const startedAt = Date.now();
    expect(
      await publishRestoredMovieToPlexV4(call.context, f.input, call.execution),
    ).toEqual({ status: "available", reason: null });
    expect(() => call.budget.consume(0)).not.toThrow();
    expect(metadataReads).toBeGreaterThanOrEqual(2);
    f.source.wire.control.beforeMetadata = () => Promise.resolve();
    expect(
      await f.context
        .userPlex("synthetic-requester")
        .metadata(f.source.wire.ratingKey),
    ).toEqual(watchBefore);
    const command = await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    });
    const envelope = MovieRestorePlexReceiptEnvelopeV1Schema.parse(
      z.object({ movieRestorePlexReceiptV1: z.unknown() }).parse(command.result)
        .movieRestorePlexReceiptV1,
    );
    const { receipt } = envelope;
    expect(envelope.receiptHash).toBe(identityHash(receipt));
    expect(receipt).toMatchObject({
      input: f.input,
      publication: {
        kind: "movie_restore_publication_v1",
        scope: f.scope,
        operationId: f.input.operationId,
        assetId: f.asset.id,
        assetVersion: before.asset.version,
      },
      expected: {
        schemaVersion: 3,
        originalItem: {
          binding: {
            evidenceId: f.initialAssociation.id,
            associationHash: f.initialAssociation.associationHash,
            revision: f.initialBinding.revision,
          },
          ratingKey: f.source.wire.ratingKey,
          part: { file: before.asset.path },
        },
      },
      binding: {
        scope: { mediaId: f.scope.mediaId, edition },
        revision: f.initialBinding.revision + 2,
      },
      assetPlexPublishedAt: before.asset.plexPublishedAt?.toISOString() ?? null,
    });
    expect(receipt.observation.verification.passes).toHaveLength(2);
    expect(receipt.observation.verification.passes[0]?.inventoryHash).toBe(
      receipt.observation.verification.passes[1]?.inventoryHash,
    );
    expect(Date.parse(receipt.reboundAt)).toBeGreaterThanOrEqual(startedAt);
    expect(Date.parse(receipt.committedAt)).toBeGreaterThanOrEqual(
      Date.parse(receipt.reboundAt),
    );
    expect(Date.parse(receipt.committedAt)).toBeLessThanOrEqual(Date.now());
    if (before.asset.plexPublishedAt !== null)
      expect(Date.parse(receipt.reboundAt)).toBeGreaterThan(
        before.asset.plexPublishedAt.getTime(),
      );
    const bound = await bindingState(f);
    expect(bound.pointer).toMatchObject({
      evidenceId: receipt.binding.evidenceId,
      associationHash: receipt.binding.associationHash,
      revision: f.initialBinding.revision + 2,
    });
    expect(bound.associations).toHaveLength(2);
    const association = PlexMovieAssociationV2Schema.parse(
      receipt.observation.associations[0],
    );
    expect(association.item).toEqual(
      PlexMovieAssociationV2Schema.parse(f.initialAssociation.evidence).item,
    );
    expect(association.group).toMatchObject({
      assetId: f.asset.id,
      assetVersion: before.asset.version,
      canonicalPath: before.asset.path,
      edition,
    });
    expect(bound.groups).toHaveLength(1);
    expect(bound.groups[0]).toMatchObject({
      group: association.group,
      members: [
        {
          mediaId: f.scope.mediaId,
          edition,
          evidenceId: receipt.binding.evidenceId,
          item: { ratingKey: association.item.ratingKey },
        },
      ],
      paths: [{ canonicalPath: before.asset.path }],
    });
    const part = association.item.media[0]?.parts[0];
    if (part === undefined)
      throw new Error("Actual Plex association omitted its Part");
    expect(bound.groups[0]?.parts).toMatchObject([
      { partId: part.id, canonicalPath: part.file },
    ]);
    expect(
      await f.db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
      }),
    ).toMatchObject({ availability: "available" });
    expect(await state(f)).toEqual(before);
    expect(await siblingState(f)).toEqual(sibling);
    expect(f.source.wire.additions()).toBe(1);
    const acknowledgement = invocation(f);
    let configured = 0;
    expect(
      await publishRestoredMovieToPlexV4(
        {
          ...acknowledgement.context,
          permittedSections: () => {
            configured++;
            return Promise.resolve({ movie: "2", series: "2" });
          },
          gates: {
            ...acknowledgement.context.gates,
            acquisition: () => Promise.resolve(false),
          },
        },
        f.input,
        acknowledgement.execution,
      ),
    ).toEqual({ status: "available", reason: null });
    expect(configured).toBe(0);
    expect(await bindingState(f)).toEqual(bound);
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: f.input.operationId },
      }),
    ).toEqual(command);
    if (edition === "directors_cut")
      await assertImmutableCompletion(f, command);
  },
  60_000,
);

test.each(["sdk", "abort", "section", "generation", "cancel_request"] as const)(
  "%s during actual restored Plex verification cannot create a binding or completion",
  async (change) => {
    const f = await ready("extended_cut");
    const before = await state(f);
    const bindings = await bindingState(f);
    const command = await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    });
    const call = invocation(f);
    const cancelled = new Error("Original restored Plex invocation cancelled");
    const expiry = new Error(
      "Original restored Plex SDK expired during metadata",
    );
    const controller = new AbortController();
    let expired = false;
    const execution = {
      ...call.execution,
      signal: controller.signal,
      assertActive: () => {
        call.execution.assertActive();
        controller.signal.throwIfAborted();
        if (expired) throw expiry;
      },
    };
    let injected = false;
    f.source.wire.control.beforeMetadata = async () => {
      if (injected) return;
      injected = true;
      if (change === "sdk") expired = true;
      if (change === "abort") controller.abort(cancelled);
      if (change === "section")
        f.context.permittedSections = () =>
          Promise.resolve({ movie: "2", series: "2" });
      if (change === "generation")
        await requestTestMovieV4(
          f.db,
          f.source.user,
          f.scope.mediaId,
          f.scope.edition,
        );
      if (change === "cancel_request") {
        const request = await f.db.mediaRequest.findUniqueOrThrow({
          where: {
            userId_mediaId_edition: {
              userId: f.source.user.id,
              mediaId: f.scope.mediaId,
              edition: f.scope.edition,
            },
          },
        });
        const target = await f.db.mediaIntent.findUniqueOrThrow({
          where: {
            mediaId_edition: {
              mediaId: f.scope.mediaId,
              edition: f.scope.edition,
            },
          },
        });
        await f.restoreRequest.commands.cancelMovieEditionRequest(
          f.source.user,
          crypto.randomUUID(),
          {
            schemaVersion: 3,
            action: "cancel_request",
            scope: f.scope,
            subjectUserId: f.source.user.id,
            requestId: request.id,
            expected: {
              targetVersion: target.version,
              requestVersion: request.version,
              choiceRevision: request.movieEditionChoiceRevision,
            },
          },
        );
      }
    };
    const effect = publishRestoredMovieToPlexV4(
      {
        ...call.context,
        movieManagement: { execution, budget: call.budget },
        plexBindingExecution: () => execution,
      },
      f.input,
      execution,
    );
    if (change === "sdk") await expect(effect).rejects.toBe(expiry);
    else if (change === "abort") await expect(effect).rejects.toBe(cancelled);
    else {
      const outcome = await effect;
      expect(outcome.status).not.toBe("available");
    }
    expect(injected).toBe(true);
    expect(await state(f)).toEqual(before);
    expect(await bindingState(f)).toEqual(bindings);
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: f.input.operationId },
      }),
    ).toEqual(command);
  },
  60_000,
);

test("restored Plex publication preserves the caller's exhausted original allowance before any network verification", async () => {
  const f = await ready("directors_cut");
  const before = await state(f);
  const bindings = await bindingState(f);
  const command = await f.db.operation.findUniqueOrThrow({
    where: { id: f.input.operationId },
  });
  const call = invocation(f);
  call.budget.consume(99);
  let metadataReads = 0;
  f.source.wire.control.beforeMetadata = () => {
    metadataReads++;
    return Promise.resolve();
  };
  await expect(
    publishRestoredMovieToPlexV4(call.context, f.input, call.execution),
  ).rejects.toMatchObject({
    code: "archive_transition_reconciliation_required",
  });
  expect(() => call.budget.consume(0)).toThrow("100 total queried records");
  expect(metadataReads).toBe(0);
  expect(await state(f)).toEqual(before);
  expect(await bindingState(f)).toEqual(bindings);
  expect(
    await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    }),
  ).toEqual(command);
}, 60_000);

test.each(["item", "part"] as const)(
  "a new Plex %s at the exact restored path and cut cannot replace the original identity",
  async (change) => {
    const f = await ready("directors_cut");
    const before = await state(f);
    const bindings = await bindingState(f);
    const command = await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    });
    const original = await f.context.plex.metadata(f.source.wire.ratingKey);
    const media = original.Media?.[0];
    const part = media?.Part[0];
    if (media === undefined || part === undefined)
      throw new Error("Actual original Plex metadata omitted its Part");
    const ratingKey = change === "item" ? "750002" : original.ratingKey;
    const partId = change === "part" ? 750_002 : part.id;
    const wire = movieWorkflowWire(f.db, {
      mediaId: f.scope.mediaId,
      edition: f.scope.edition,
      downloads: f.source.files.roots.movies.downloads,
      bytes,
      title: f.source.media.title,
      year: z.number().parse(f.source.media.year),
      ratingKey,
      partId,
    });
    // Only the selected Plex identity differs; canonical identity, edition,
    // physical path, size and every other returned metadata field are real.
    expect(await wire.plex.metadata(ratingKey)).toEqual({
      ...original,
      ratingKey,
      Media: [{ ...media, Part: [{ ...part, id: partId }] }],
    });
    let metadataReads = 0;
    wire.control.beforeMetadata = () => {
      metadataReads++;
      return Promise.resolve();
    };
    const call = invocation(f);
    const outcome = await publishRestoredMovieToPlexV4(
      {
        ...call.context,
        plex: wire.plex,
        userPlex: wire.userPlex,
      },
      f.input,
      call.execution,
    );
    expect(outcome).toEqual({ status: "waiting", reason: "metadata_changed" });
    expect(metadataReads).toBeGreaterThanOrEqual(1);
    expect(() => call.budget.consume(0)).not.toThrow();
    expect(await state(f)).toEqual(before);
    expect(await bindingState(f)).toEqual(bindings);
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: f.input.operationId },
      }),
    ).toEqual(command);
  },
  60_000,
);
