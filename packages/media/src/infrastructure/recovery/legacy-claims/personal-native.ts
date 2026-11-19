import type { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { RecoveryClaimProjection } from "#shared/recovery-claims.ts";
import type {
  PersonalMigrationClaim,
  ImportedPersonalClaimSchema,
} from "#shared/personal-migration/contract.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { catalogIdentity } from "#migration/catalog-targets.ts";
import { snapshotHash } from "#migration/profile-import.ts";

type Ref = z.infer<typeof ImportedPersonalClaimSchema>;
type RequestRecord = Extract<MigrationRecord, { kind: "request" }>;
export type PersonalNativeInput = {
  selected: PersonalMigrationClaim;
  refs: Ref[];
  record: RequestRecord;
  claim?: RecoveryClaimProjection | undefined;
  edition?: string | undefined;
  budget?: PublicationAuthorityReadBudget | undefined;
};
function sameClaim(input: PersonalNativeInput) {
  const { selected, claim } = input;
  return (
    claim !== undefined &&
    ["import", "existing"].includes(selected.disposition) &&
    selected.bindingId === claim.bindingId &&
    selected.bindingRevision === claim.bindingRevision &&
    selected.userId === claim.userId &&
    selected.requesterSourceId === claim.requesterSourceId &&
    selected.edition === (input.edition ?? "default") &&
    selected.mediaIds.length > 0
  );
}
function sameRefs({ selected, refs }: PersonalNativeInput) {
  return (
    refs.length === selected.mediaIds.length &&
    new Set(refs.map((ref) => ref.mediaId)).size === refs.length &&
    refs.every(
      (ref) =>
        selected.mediaIds.includes(ref.mediaId) &&
        ref.userId === selected.userId &&
        ref.edition === selected.edition &&
        ref.sourceId === selected.sourceId &&
        ref.sourceStatus === selected.sourceStatus,
    )
  );
}
type Target = Prisma.MediaItemGetPayload<{
  include: { parent: { include: { parent: true } } };
}>;
function exactTarget(target: Target, record: RequestRecord) {
  const root = target.kind === "season" ? target.parent : target;
  if (root === null || target.kind !== record.scope) return false;
  const ids = catalogIdentity(root);
  return (
    Object.entries(record.externalIds).length > 0 &&
    Object.entries(record.externalIds).every(
      ([key, value]) => Reflect.get(ids, key) === value,
    )
  );
}
const coordinateOrder = (a: number | null, b: number | null) =>
  (a ?? -1) - (b ?? -1);
function exactTargets(targets: Target[], input: PersonalNativeInput) {
  return (
    targets.length === input.selected.mediaIds.length &&
    targets.every((target) => exactTarget(target, input.record)) &&
    (input.record.scope !== "season" ||
      snapshotHash(
        targets.map((target) => target.seasonNumber).sort(coordinateOrder),
      ) === snapshotHash([...input.record.seasons].sort(coordinateOrder)))
  );
}
export async function personalNativeAccounted(
  tx: Prisma.TransactionClient,
  input: PersonalNativeInput,
) {
  if (!sameClaim(input) || !sameRefs(input) || input.claim === undefined)
    return false;
  const { refs, selected, claim, budget } = input;
  const requests = await tx.mediaRequest.findMany({
    where: { id: { in: refs.map((ref) => ref.requestId) } },
    orderBy: { id: "asc" },
  });
  budget?.consume(requests.length);
  if (
    requests.length !== refs.length ||
    !refs.every((ref) =>
      requests.some(
        (request) =>
          request.id === ref.requestId &&
          request.userId === ref.userId &&
          request.mediaId === ref.mediaId &&
          request.edition === ref.edition,
      ),
    )
  )
    return false;
  const targets = await tx.mediaItem.findMany({
    where: { id: { in: selected.mediaIds } },
    include: { parent: { include: { parent: true } } },
  });
  budget?.consume(targets.length * 3);
  if (!exactTargets(targets, input)) return false;
  const media = await tx.mediaItem.findMany({
    where: { id: { in: claim.mediaIds } },
    select: {
      id: true,
      parentId: true,
      parent: { select: { parentId: true } },
    },
  });
  budget?.consume(media.length * 2);
  return (
    media.length === claim.mediaIds.length &&
    media.every((item) =>
      selected.mediaIds.some(
        (id) =>
          id === item.id ||
          id === item.parentId ||
          id === item.parent?.parentId,
      ),
    )
  );
}
