import type { Database } from "#infrastructure/database.ts";
import type { NativePlexProofParent } from "#shared/plex-binding/native.ts";
import { NativePlexObservationSchema } from "#shared/plex-binding/native.ts";
import { NativeArchiveNetworkEvidenceSchema } from "#shared/native-recovery/archive.ts";
import { PlexAssociationV1Schema } from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  readPlexCanonicalTargets,
  readNativePlexCanonicalTargets,
} from "#infrastructure/plex-binding/canonical.ts";
import { NativeStoredScopeSchema } from "#shared/native-recovery/lifecycle.ts";
import {
  readPlexDefinition,
  readPlexPhysicalGroup,
} from "#infrastructure/plex-binding/read.ts";

/** Reader fixture only: actual native network evidence, explicitly synthetic Plex item/Part IDs.
 * It does not install serving bindings or claim matching-build wire acceptance. */
export async function nativeBudgetObservation(
  db: Database,
  parent: NativePlexProofParent,
) {
  const row = await db.nativeRecoveryObservation.findFirstOrThrow({
    where: { planId: parent.planId, kind: "network" },
    orderBy: { createdAt: "desc" },
  });
  if (identityHash(row.evidence) !== row.evidenceHash)
    throw new Error("Fixture network raw hash changed");
  const historicalNetwork = NativeArchiveNetworkEvidenceSchema.parse(
    row.evidence,
  );
  const mediaIds = historicalNetwork.plex.currentPlayback
    .flatMap((playback) => playback.items.map((item) => item.mediaId))
    .sort();
  // Only the NEW synthetic pair uses decimal wire IDs. Its legacy source row stays literal.
  const currentPlayback = historicalNetwork.plex.currentPlayback.map(
    (playback) => ({
      ...playback,
      items: playback.items.map((item) => ({
        ...item,
        ratingKey: String(mediaIds.indexOf(item.mediaId) + 1),
      })),
    }),
  );
  // The new pair has its own shorter proof window; the historical row stays literal.
  const network = NativeArchiveNetworkEvidenceSchema.parse({
    ...historicalNetwork,
    plex: { ...historicalNetwork.plex, currentPlayback },
    expiresAt: new Date(
      Math.min(
        Date.parse(historicalNetwork.expiresAt),
        Date.parse(historicalNetwork.capturedAt) + 60_000,
      ),
    ).toISOString(),
  });
  const present = [];
  for (const playback of network.plex.currentPlayback) {
    const { group } = await readPlexPhysicalGroup(db, playback.assetId);
    const targets = await readPlexCanonicalTargets(db, group.coverage);
    for (const target of targets) {
      const item = playback.items.find(
        (value) => value.mediaId === target.scope.mediaId,
      );
      if (item === undefined || target.kind !== "movie")
        throw new Error(
          "Budget fixture requires an actual movie playback group",
        );
      present.push(
        PlexAssociationV1Schema.parse({
          schemaVersion: 1,
          kind: "movie",
          scope: target.scope,
          editionRootId: target.canonicalRootId,
          definition: await readPlexDefinition(
            db,
            target.scope,
            target.canonicalRootId,
          ),
          canonicalIdentityHash: target.canonicalIdentityHash,
          numberingHash: target.numberingHash,
          group,
          access: {
            serverMachineId: "server",
            sectionId: item.sectionId,
            sectionType: "movie",
          },
          item: {
            ratingKey: item.ratingKey,
            type: "movie",
            guids: target.references
              .map((reference) => `${reference.namespace}://${reference.value}`)
              .sort(),
            media: [
              {
                parts: [
                  {
                    id: "98765",
                    file: item.canonicalPath,
                    sizeBytes: group.sizeBytes,
                  },
                ],
              },
            ],
          },
        }),
      );
    }
  }
  const absent = network.plex.archiveAbsence.map((item) => ({
    assetId: item.assetId,
    sectionId: item.sectionId,
    canonicalPaths: item.paths,
    inventoryHash: identityHash(network.plex.inventory),
  }));
  const completedAt = new Date().toISOString();
  const pass = {
    itemCount: present.length,
    inventoryHash: identityHash(network.plex.inventory),
    selectedHash: identityHash({ present }),
  };
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: parent.planId },
  });
  const observation = NativePlexObservationSchema.parse({
    purpose: parent.purpose,
    parent,
    canonicalTargets: await readNativePlexCanonicalTargets(
      db,
      NativeStoredScopeSchema.parse(plan.scope),
    ),
    present,
    absent,
    verification: {
      startedAt: network.capturedAt,
      completedAt,
      expiresAt: network.expiresAt,
      sections: network.plex.inventory
        .map((item) => ({
          sectionId: item.sectionId,
          sectionType: item.kind === "movie" ? "movie" : "show",
        }))
        .sort((a, b) => a.sectionId.localeCompare(b.sectionId)),
      passes: [pass, pass],
    },
  });
  return {
    network,
    observation,
    timing: {
      startedAt: network.capturedAt,
      completedAt,
      sessionsCheckedAt: completedAt,
      expiresAt: network.expiresAt,
    },
  };
}
