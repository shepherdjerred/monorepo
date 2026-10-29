import type { HandoffNetworkContext } from "./context.ts";
import { protectedEvidence } from "./context.ts";
import { observePlex } from "./plex.ts";
import type { LoadedHandoffPlan } from "./plan.ts";
import { capturePlexEditionSnapshotV1 } from "./plex-edition.ts";
import { HandoffNetworkV2Schema } from "#shared/handoff-v2.ts";
import { HandoffNetworkV3Schema } from "#shared/handoff/library-v3.ts";

/** Fresh v3 facts never reuse or reinterpret an earlier edition-bearing identity hash. */
export async function observeLibraryPlexV3(
  context: HandoffNetworkContext,
  input: LoadedHandoffPlan,
  signal: AbortSignal,
) {
  if (!("schemaVersion" in input.scope) || input.scope.schemaVersion !== 3)
    throw protectedEvidence("handoff_plex_edit_protocol_required");
  const read = context.plex.metadataForEditionEdit?.bind(context.plex);
  if (read === undefined)
    throw protectedEvidence("handoff_plex_edit_observer_missing");
  const observed = await observePlex(context, input, signal, {
    editionLabels: "observe",
  });
  const result = [];
  for (const raw of observed) {
    const association = HandoffNetworkV2Schema.shape.plex.element.parse(raw);
    const file = input.scope.files.find(
      (item) => item.assetId === association.assetId,
    );
    const media = input.media.find((item) => item.id === association.mediaId);
    if (file === undefined || media === undefined)
      throw protectedEvidence("handoff_plex_media_missing");
    if (file.libraryKind !== "movies") {
      result.push({ ...association, movieEdition: null });
      continue;
    }
    const item = await read(association.ratingKey, signal);
    const snapshot = capturePlexEditionSnapshotV1(item, {
      serverMachineId: context.expectedServerMachineId,
      sectionId: association.sectionId,
      media,
      canonicalPath: file.canonicalPath,
      sizeBytes: file.sizeBytes,
    });
    if (
      snapshot.identity.partId !== association.partId ||
      snapshot.identity.ratingKey !== association.ratingKey
    )
      throw protectedEvidence("handoff_plex_edit_identity_changed");
    result.push({
      ...association,
      identityHash: snapshot.identityHash,
      editionTitle: snapshot.editionTitle,
      movieEdition: snapshot,
    });
  }
  const server = await context.plex.machineIdentifier(signal);
  signal.throwIfAborted();
  if (server !== context.expectedServerMachineId)
    throw protectedEvidence("handoff_plex_server_changed");
  return HandoffNetworkV3Schema.shape.plex.parse(result);
}
