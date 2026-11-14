import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { LibraryHandoffScope } from "#shared/handoff/protocol.ts";
import type { PassiveRegistrationApproval } from "#shared/handoff/passive-registration.ts";
import {
  ExternalLibraryRegistrationEventSchema,
  ExternalLibraryRegistrationSchema,
  EXTERNAL_LIBRARY_REGISTERED_EVENT,
} from "#shared/external-library/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { canonicalJson } from "#migration/profile-import.ts";

type File = LibraryHandoffScope["files"][number];
type Request = Pick<LibraryHandoffScope["request"], "schemaVersion"> & {
  registeredAssets?: PassiveRegistrationApproval[] | undefined;
};
type FileIdentity = Pick<
  File,
  "assetId" | "existingAssetId" | "existingAssetVersion" | "provenanceKey"
>;
type PassiveFile = Pick<
  File,
  | "assetId"
  | "existingAssetId"
  | "existingAssetVersion"
  | "canonicalPath"
  | "mediaIds"
  | "sizeBytes"
  | "libraryKind"
>;
const hash = (value: unknown) => identityHash(nativeJson(value));
const conflict = () =>
  new Error("Passive library registration changed or has another owner");

export function passiveRegistrationApproval(
  request: Request,
  file: Pick<File, "provenanceKey">,
) {
  const all =
    request.schemaVersion === 3 ? (request.registeredAssets ?? []) : [];
  const matches = all.filter(
    (entry) => entry.provenanceKey === file.provenanceKey,
  );
  if (matches.length > 1) throw conflict();
  return matches[0];
}

/** Old receipt readers stay strict; only this exact new lineage grants version one. */
export function initialLibraryAssetVersion(
  request: Request,
  file: FileIdentity,
) {
  const approval = passiveRegistrationApproval(request, file);
  if (approval === undefined) {
    if (file.existingAssetId !== null) throw conflict();
    return 0;
  }
  if (
    file.assetId !== approval.assetId ||
    file.existingAssetId !== approval.assetId ||
    file.existingAssetVersion !== approval.expectedVersion
  )
    throw conflict();
  return approval.expectedVersion + 1;
}

export async function assertPassiveRegistration(
  tx: Prisma.TransactionClient,
  approval: PassiveRegistrationApproval,
  file: PassiveFile,
) {
  await tx.$queryRaw`SELECT id FROM "LibraryAsset" WHERE id=${approval.assetId} FOR UPDATE`;
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: approval.assetId },
    include: { coverage: true },
  });
  const event = await tx.applicationEvent.findUniqueOrThrow({
    where: { id: approval.registrationEventId },
  });
  return validatePassiveRegistration({ approval, file, asset, event });
}

export function validatePassiveRegistration(input: {
  approval: PassiveRegistrationApproval;
  file: PassiveFile;
  asset: Pick<
    Prisma.LibraryAssetGetPayload<{ include: { coverage: true } }>,
    | "id"
    | "version"
    | "owned"
    | "ownershipEpoch"
    | "torrentId"
    | "checksum"
    | "sourcePath"
    | "state"
    | "edition"
    | "editionRootId"
    | "path"
    | "sizeBytes"
    | "properties"
    | "coverage"
  >;
  event: { id: string; kind: string; mediaId: string | null; payload: unknown };
}) {
  const { approval, file, asset, event } = input;
  const { registration, registrationHash } =
    ExternalLibraryRegistrationEventSchema.parse(event.payload);
  const stored = z
    .object({ externalLibrary: ExternalLibraryRegistrationSchema })
    .parse(asset.properties).externalLibrary;
  assertPassiveIdentity({
    approval,
    file,
    asset,
    event,
    registration,
    registrationHash,
    stored,
  });
  if (
    asset.owned ||
    asset.ownershipEpoch !== -1 ||
    asset.torrentId !== null ||
    asset.checksum !== null ||
    asset.sourcePath !== null ||
    asset.state !== "published" ||
    asset.edition !== "default" ||
    asset.editionRootId !== registration.rootMediaId ||
    asset.path !== file.canonicalPath ||
    registration.canonicalPath !== asset.path ||
    asset.sizeBytes.toString() !== file.sizeBytes ||
    registration.sizeBytes !== file.sizeBytes ||
    registration.sectionType !==
      (file.libraryKind === "movies" ? "movie" : "show") ||
    asset.coverage.some(
      (entry) => !entry.current || entry.edition !== "default",
    ) ||
    hash(asset.coverage.map((entry) => entry.mediaId).sort()) !==
      hash([...file.mediaIds].sort()) ||
    hash(registration.members.map((entry) => entry.mediaId).sort()) !==
      hash([...file.mediaIds].sort())
  )
    throw conflict();
  return registration;
}

function assertPassiveIdentity(
  input: Parameters<typeof validatePassiveRegistration>[0] & {
    registration: z.infer<typeof ExternalLibraryRegistrationSchema>;
    registrationHash: string;
    stored: z.infer<typeof ExternalLibraryRegistrationSchema>;
  },
) {
  const {
    approval,
    file,
    asset,
    event,
    registration,
    registrationHash,
    stored,
  } = input;
  if (
    event.kind !== EXTERNAL_LIBRARY_REGISTERED_EVENT ||
    event.mediaId !== registration.rootMediaId ||
    registration.registrationEventId !== event.id ||
    hash(registration) !== registrationHash ||
    canonicalJson(nativeJson(registration)) !== approval.registrationRaw ||
    registrationHash !== approval.registrationHash ||
    hash(stored) !== registrationHash ||
    file.existingAssetId !== asset.id ||
    file.assetId !== asset.id ||
    asset.version !== approval.expectedVersion ||
    file.existingAssetVersion !== asset.version ||
    asset.id !== approval.assetId
  )
    throw conflict();
}

/** Fresh trusted Plex observations must retain the registered item and physical Part. */
export async function assertPassiveRegistrationAssociations(
  tx: Prisma.TransactionClient,
  scope: LibraryHandoffScope,
  plex: readonly {
    assetId: string;
    mediaId: string;
    sectionId: string;
    ratingKey: string;
    partId: number;
    canonicalPath: string;
  }[],
  serverMachineId: string | undefined,
) {
  for (const file of scope.files) {
    const approval = passiveRegistrationApproval(scope.request, file);
    if (approval === undefined) continue;
    const registration = await assertPassiveRegistration(tx, approval, file);
    if (registration.serverMachineId !== serverMachineId) throw conflict();
    const actual = plex.filter((entry) => entry.assetId === file.assetId);
    if (
      actual.length !== registration.members.length ||
      registration.members.some(
        (member) =>
          actual.filter(
            (entry) =>
              entry.mediaId === member.mediaId &&
              entry.ratingKey === member.ratingKey &&
              String(entry.partId) === member.partId &&
              entry.sectionId === registration.sectionId &&
              entry.canonicalPath === registration.canonicalPath,
          ).length !== 1,
      )
    )
      throw conflict();
  }
}
