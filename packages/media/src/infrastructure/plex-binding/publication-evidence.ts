import type { Prisma } from "#generated/prisma/client.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  PlexAssociationV1Schema,
  plexScopeKey,
} from "#shared/plex-binding/contract.ts";
import type { DefaultAcquisitionPlexReceipt } from "#shared/acquisition/library-publication.ts";
import { parsePlexRecord } from "./records.ts";

/** Historical immutable evidence only; current pointers and later ownership are irrelevant to ACK. */
export async function assertAcquisitionPlexEvidence(
  tx: Prisma.TransactionClient,
  receipt: DefaultAcquisitionPlexReceipt,
) {
  const { expected, completion } = receipt;
  const expectedScopes = expected.newGroups
    .flatMap((group) => group.coverage.map((scope) => plexScopeKey(scope)))
    .sort();
  if (
    identityHash(expectedScopes) !==
    identityHash(
      completion.bindings.map((binding) => plexScopeKey(binding.scope)),
    )
  )
    throw new Error("Acquisition Plex completion omitted complete groups");
  const rows = await tx.plexAssociationEvidence.findMany({
    where: {
      id: { in: completion.bindings.map((binding) => binding.evidenceId) },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const groups = new Set(
    expected.newGroups.map((group) => identityHash(group)),
  );
  const access = new Set(expected.access.map((value) => identityHash(value)));
  const targets = new Map(
    expected.targets.map((target) => [plexScopeKey(target.scope), target]),
  );
  for (const binding of completion.bindings) {
    const row = byId.get(binding.evidenceId);
    if (row?.associationHash !== binding.associationHash)
      throw new Error("Acquisition Plex completion evidence missing");
    const association = parsePlexRecord(
      PlexAssociationV1Schema,
      row.evidence,
      row.associationHash,
    );
    const target = targets.get(plexScopeKey(binding.scope));
    if (
      target === undefined ||
      identityHash(association.scope) !== identityHash(binding.scope) ||
      row.mediaId !== binding.scope.mediaId ||
      row.edition !== binding.scope.edition ||
      row.assetId !== association.group.assetId ||
      row.serverMachineId !== association.access.serverMachineId ||
      !groups.has(identityHash(association.group)) ||
      !access.has(identityHash(association.access)) ||
      target.editionRootId !== association.editionRootId ||
      target.canonicalIdentityHash !== association.canonicalIdentityHash ||
      target.numberingHash !== association.numberingHash ||
      identityHash(target.definition) !== identityHash(association.definition)
    )
      throw new Error("Acquisition Plex completion immutable binding changed");
  }
}
