import { beforeAll, expect, onTestFinished, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { moviePlexV4Fixture } from "#testing/movie-plex-v4.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { publishMoviePlexV4 } from "#automation/movie-editions/plex-publication.ts";
import { finalizeMovieAcquisitionV4 } from "#automation/movie-editions/finalization.ts";
import { captureExistingPlexBindingExpected } from "#infrastructure/plex-binding/cold.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { Database } from "#infrastructure/database.ts";
import { Prisma } from "#generated/prisma/client.ts";

const h = automationTestHarness();
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});

/** Bypass TS admission deliberately: the actual SQL trigger must reject each changed parent. */
async function insertRequest(
  db: Database,
  expected: unknown,
  asset: { id: string; epoch: number },
  duplicateAsset = false,
) {
  const operationId = crypto.randomUUID();
  const assetIds = duplicateAsset ? [asset.id, asset.id] : [asset.id];
  const value = z.record(z.string(), z.json()).parse(expected);
  const payload = {
    schemaVersion: 1,
    kind: "reverify_plex_binding",
    operationId,
    recoveryEpoch: asset.epoch,
    assetIds,
  };
  return db.$transaction(async (tx) => {
    await tx.operation.create({
      data: {
        id: operationId,
        kind: payload.kind,
        targetId: asset.id,
        payload,
      },
    });
    await tx.$executeRaw(Prisma.sql`INSERT INTO "PlexBindingVerificationRequest"("operationId","expected","expectedHash","recoveryEpoch","assetIds")
      VALUES(${operationId},${JSON.stringify(value)}::jsonb,${identityHash(value)},${asset.epoch},ARRAY[${Prisma.join(assetIds)}]::text[])`);
    return operationId;
  });
}

test.each(["default", "extended_cut"] as const)(
  "SQL admits only the genuine singleton %s movie inventory parent and rejects changed authority atomically",
  async (edition) => {
    const db = h.database();
    const f = await moviePlexV4Fixture(db, h.context(), await h.fixture(), {
      edition,
      bytes,
    });
    onTestFinished(() =>
      rm(f.files.directory, { recursive: true, force: true }),
    );
    expect(
      await publishMoviePlexV4(f.network, f.input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    await finalizeMovieAcquisitionV4(
      f.network,
      f.input,
      testPlexBindingExecution(),
    );
    const expected = await captureExistingPlexBindingExpected(db, {
      assetIds: [f.asset.id],
      access: [
        {
          serverMachineId: "fixture-server",
          sectionId: "1",
          sectionType: "movie",
        },
      ],
    });
    const parent = expected.parents[0];
    const pointer = expected.previous[0];
    const physical = expected.newGroups[0];
    if (
      physical === undefined ||
      pointer?.evidence == null ||
      parent?.kind !== "existing_movie_asset_v2" ||
      parent.physicalGrant.kind !== "movie_publication_transition_v2"
    )
      throw new Error(
        "Real movie producer omitted its current typed V2 parent",
      );
    const asset = { id: f.asset.id, epoch: parent.recoveryEpoch };
    const originalAsset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: asset.id },
    });
    const originalPointer = await db.plexBindingCurrent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition } },
    });
    const before = {
      commands: await db.operation.count(),
      requests: await db.plexBindingVerificationRequest.count(),
    };
    const foreign = crypto.randomUUID();
    const changes = [
      {
        name: "foreign canonical scope",
        value: {
          ...expected,
          parents: [
            {
              ...parent,
              scope: {
                ...parent.scope,
                rootMediaId: foreign,
                mediaId: foreign,
              },
            },
          ],
        },
      },
      {
        name: "other cut",
        value: {
          ...expected,
          parents: [
            {
              ...parent,
              scope: {
                ...parent.scope,
                edition: edition === "default" ? "extended_cut" : "default",
              },
            },
          ],
        },
      },
      {
        name: "foreign asset",
        value: { ...expected, parents: [{ ...parent, assetId: foreign }] },
      },
      {
        name: "wrong asset version",
        value: {
          ...expected,
          parents: [{ ...parent, assetVersion: parent.assetVersion + 1 }],
        },
      },
      {
        name: "wrong epoch",
        value: {
          ...expected,
          parents: [{ ...parent, recoveryEpoch: parent.recoveryEpoch + 1 }],
        },
      },
      {
        name: "changed real publication reference",
        value: {
          ...expected,
          parents: [
            {
              ...parent,
              physicalGrant: {
                ...parent.physicalGrant,
                outcomeHash: "0".repeat(64),
              },
            },
          ],
        },
      },
      {
        name: "foreign current pointer",
        value: {
          ...expected,
          previous: [
            { ...pointer, evidence: { ...pointer.evidence, id: foreign } },
          ],
        },
      },
      {
        name: "extra parent",
        value: { ...expected, parents: [parent, parent] },
      },
      {
        name: "incomplete physical coverage",
        value: { ...expected, newGroups: [{ ...physical, coverage: [] }] },
      },
      {
        name: "missing expected array",
        value: { ...expected, newGroups: null },
      },
    ];
    for (const changed of changes) {
      await expect(
        insertRequest(db, changed.value, asset),
        changed.name,
      ).rejects.toThrow();
      expect({
        commands: await db.operation.count(),
        requests: await db.plexBindingVerificationRequest.count(),
      }).toEqual(before);
    }
    await expect(insertRequest(db, expected, asset, true)).rejects.toThrow();
    if (edition !== "default") {
      const ordinary = {
        ...expected,
        parents: [
          {
            kind: "existing_asset",
            assetId: asset.id,
            assetVersion: parent.assetVersion,
            recoveryEpoch: parent.recoveryEpoch,
            physicalGrant: null,
          },
        ],
      };
      await expect(insertRequest(db, ordinary, asset)).rejects.toThrow(
        "default targets only",
      );
    }
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: asset.id } }),
    ).toEqual(originalAsset);
    expect(
      await db.plexBindingCurrent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.media.id, edition } },
      }),
    ).toEqual(originalPointer);
    const operationId = await insertRequest(db, expected, asset);
    expect(
      await db.plexBindingVerificationRequest.findUniqueOrThrow({
        where: { operationId },
      }),
    ).toMatchObject({
      expectedHash: identityHash(expected),
      recoveryEpoch: asset.epoch,
      assetIds: [asset.id],
    });
  },
);
