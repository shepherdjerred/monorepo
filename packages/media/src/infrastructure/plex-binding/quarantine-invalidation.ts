import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  CommittedQuarantinePlexReceiptSchema,
  type CommittedQuarantinePlexReceipt,
} from "#shared/plex-binding/watch.ts";
import {
  plexScopeKey,
  type PlexAssociationV1,
  type PlexBindingFreshness,
} from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readPlexPointers, parsePlexRecord } from "./records.ts";
import { readPlexPhysicalGroup } from "./read.ts";
import { plexCanonicalPathHash } from "./path.ts";
import { replacePlexClaims } from "./claims.ts";
import { bindPlexTransactionDeadline } from "./freshness.ts";
import { PlexBindingProtection } from "./errors.ts";

/** Only the just-written quarantine receipt can retire its exact former serving associations. */
export async function retireQuarantinedPlexBindings(
  tx: Prisma.TransactionClient,
  receipt: CommittedQuarantinePlexReceipt,
  freshness: PlexBindingFreshness,
): Promise<void> {
  freshness.assertActive();
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: receipt.operationId },
  });
  freshness.assertActive();
  const raw = z
    .object({ quarantinePlexReceipt: z.json() })
    .parse(operation.result).quarantinePlexReceipt;
  const stored = parsePlexRecord(
    CommittedQuarantinePlexReceiptSchema,
    raw,
    identityHash(receipt),
  );
  if (identityHash(stored) !== identityHash(receipt))
    throw new PlexBindingProtection("scope_changed");
  const pointers = await readPlexPointers(
    tx,
    receipt.bindings.map((binding) => binding.scope),
  );
  freshness.assertActive();
  const groups = new Map(
    receipt.groups.map((group) => [group.assetId, identityHash(group)]),
  );
  const members = pointers.map((pointer, index) => {
    const binding = receipt.bindings[index];
    if (
      binding === undefined ||
      pointer.current === null ||
      identityHash(pointer.current.snapshot) !== identityHash(binding) ||
      groups.get(pointer.current.association.group.assetId) !==
        identityHash(pointer.current.association.group)
    )
      throw new PlexBindingProtection("binding_changed");
    return {
      association: pointer.current.association,
      evidenceId: binding.evidenceId,
      associationHash: binding.associationHash,
    };
  });
  const servers = [
    ...new Set(
      members.map((member) => member.association.access.serverMachineId),
    ),
  ];
  const serverMachineId = servers[0];
  if (serverMachineId === undefined || servers.length !== 1)
    throw new PlexBindingProtection("wrong_server");
  for (const group of receipt.groups) {
    const current = await readPlexPhysicalGroup(tx, group.assetId);
    freshness.assertActive();
    if (
      current.asset.state !== "quarantined" ||
      identityHash(current.group) !==
        identityHash({ ...group, assetVersion: group.assetVersion + 1 })
    )
      throw new PlexBindingProtection("ownership_changed");
  }
  await assertQuarantineClaims(tx, receipt, {
    members,
    serverMachineId,
    freshness,
  });
  await bindPlexTransactionDeadline(tx, freshness);
  await replacePlexClaims(
    tx,
    { serverMachineId, oldGroups: receipt.groups, members: [] },
    freshness,
  );
  // The complete group is locked before the physical change; CAS still refuses any different winner.
  const cleared = await tx.$executeRaw`UPDATE "PlexBindingCurrent" p SET
    "evidenceId"=NULL,"associationHash"=NULL,revision=p.revision+1,"verifiedStartedAt"=NULL,"verifiedCompletedAt"=NULL
    FROM jsonb_to_recordset(${JSON.stringify(
      receipt.bindings.map((binding) => ({
        ...binding.scope,
        evidenceId: binding.evidenceId,
        associationHash: binding.associationHash,
        revision: binding.revision,
      })),
    )}::jsonb)
      AS r("mediaId" text,edition text,"evidenceId" text,"associationHash" text,revision integer)
    WHERE p."mediaId"=r."mediaId" AND p.edition=r.edition AND p."evidenceId"=r."evidenceId"
      AND p."associationHash"=r."associationHash" AND p.revision=r.revision`;
  freshness.assertActive();
  if (cleared !== receipt.bindings.length)
    throw new PlexBindingProtection("binding_changed");
  const scopes = receipt.bindings.map((binding) => binding.scope);
  await tx.plexWatchProjection.deleteMany({ where: { OR: scopes } });
  freshness.assertActive();
  await tx.watchState.deleteMany({ where: { OR: scopes } });
  freshness.assertActive();
  // RetentionPlexProjection and quarantined decisions are immutable recovery/watch parents, not stale warnings.
}

type Member = {
  association: PlexAssociationV1;
  evidenceId: string;
  associationHash: string;
};
type ClaimedGroup = Prisma.PlexClaimGroupGetPayload<{
  include: { members: { include: { item: true } }; parts: true; paths: true };
}>;
async function assertQuarantineClaims(
  tx: Prisma.TransactionClient,
  receipt: CommittedQuarantinePlexReceipt,
  input: {
    members: Member[];
    serverMachineId: string;
    freshness: PlexBindingFreshness;
  },
) {
  const { members, serverMachineId, freshness } = input;
  const groups = await tx.plexClaimGroup.findMany({
    where: {
      serverMachineId,
      groupHash: { in: receipt.groups.map((group) => identityHash(group)) },
    },
    include: { members: { include: { item: true } }, parts: true, paths: true },
  });
  freshness.assertActive();
  if (groups.length !== receipt.groups.length)
    throw new PlexBindingProtection("binding_changed");
  for (const group of groups) {
    const physical = receipt.groups.find(
      (value) => identityHash(value) === group.groupHash,
    );
    const selected = members.filter(
      (member) => member.association.group.assetId === physical?.assetId,
    );
    if (
      physical === undefined ||
      identityHash(group.group) !== group.groupHash ||
      selected.length !== group.members.length
    )
      throw new PlexBindingProtection("binding_changed");
    const byScope = new Map(
      selected.map((member) => [
        plexScopeKey(member.association.scope),
        member,
      ]),
    );
    for (const member of group.members) {
      const expected = byScope.get(plexScopeKey(member));
      assertQuarantineClaimMember(member, expected, serverMachineId);
    }
    const parts = new Map(
      selected.map((member) => {
        const part = member.association.item.media[0].parts[0];
        return [part.id, part.file];
      }),
    );
    if (
      group.parts.length !== parts.size ||
      group.parts.some(
        (part) =>
          part.serverMachineId !== serverMachineId ||
          parts.get(part.partId) !== part.canonicalPath,
      ) ||
      group.paths.length !== 1 ||
      group.paths[0]?.serverMachineId !== serverMachineId ||
      group.paths[0].canonicalPath !== physical.canonicalPath ||
      group.paths[0].canonicalPathHash !==
        plexCanonicalPathHash(physical.canonicalPath)
    )
      throw new PlexBindingProtection("binding_changed");
  }
}

function assertQuarantineClaimMember(
  member: ClaimedGroup["members"][number],
  expected: Member | undefined,
  serverMachineId: string,
) {
  if (expected === undefined)
    throw new PlexBindingProtection("binding_changed");
  const item = member.item;
  if (
    member.evidenceId !== expected.evidenceId ||
    member.associationHash !== expected.associationHash ||
    item?.evidenceId !== expected.evidenceId ||
    item.associationHash !== expected.associationHash ||
    item.serverMachineId !== serverMachineId ||
    item.sectionId !== expected.association.access.sectionId ||
    item.ratingKey !== expected.association.item.ratingKey
  )
    throw new PlexBindingProtection("binding_changed");
}
