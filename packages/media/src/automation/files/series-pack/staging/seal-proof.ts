import path from "node:path";
import type { ContentProof } from "#filesystem/content-proof.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import { durablePublicationJournal } from "#filesystem/publication-proof/journal.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { loadSeriesPackStagingBatchesV1 } from "#infrastructure/acquisition-identity/series-pack/staging/seal.ts";
import {
  FileGuardError,
  type FileContext,
  type FilePlanEntry,
} from "#automation/files/types.ts";

/** Called inside the original held transaction/path locks with its same sealed
 * proof. It reads every staged member and extracted caption in original order. */
export async function assertSeriesPackStagedBytesV1(
  context: FileContext,
  input: { contentProof: ContentProof; plan: readonly FilePlanEntry[] },
) {
  for (const entry of input.plan) {
    if (
      (await input.contentProof.digest(
        path.join(context.roots.tv.control, `staging/${entry.operationId}`),
      )) !== entry.checksum
    )
      throw new FileGuardError("series_pack_staging_content_changed");
    for (const subtitle of entry.embeddedSubtitles)
      if (
        (await input.contentProof.digest(
          path.join(context.roots.tv.control, subtitle.relativePath),
        )) !== subtitle.checksum
      )
        throw new FileGuardError("embedded_content_changed");
  }
}

export async function assertSeriesPackStagingJournalsV1(
  context: FileContext,
  receipts: Awaited<
    ReturnType<typeof loadSeriesPackStagingBatchesV1>
  >["receipts"],
) {
  for (const receipt of receipts) {
    if (receipt.result === null) throw new Error("Incomplete staging parent");
    for (const expected of receipt.result.completion.journals) {
      const actual = await durablePublicationJournal(
        context.roots.tv,
        ManifestSchema.parse(JSON.parse(expected.raw)),
      );
      if (identityHash(actual) !== identityHash(expected))
        throw new FileGuardError("series_pack_staging_journal_changed");
    }
  }
}
