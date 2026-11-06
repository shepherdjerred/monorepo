import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeSubtitleSnapshotSchema,
  type NativeSubtitleSnapshot,
} from "#shared/native-subtitles.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { InstalledSubtitleInput } from "#infrastructure/native-quarantine/installed-subtitle-types.ts";
import { terminalSubtitleChain } from "#infrastructure/native-recovery/terminal-subtitles.ts";
import { readMovieSubtitleReceiptV4 } from "#infrastructure/movie-editions/subtitle-receipt.ts";
import { readMovieReplacementReceiptV2 } from "./records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";

const hash = (value: unknown) => identityHash(nativeJson(value));

/** A later installed caption keeps its actual installation parent through every real swap. */
export async function movieReplacementInstallationLineageV2(
  tx: Prisma.TransactionClient,
  input: {
    original: NativeSubtitleSnapshot;
    current: InstalledSubtitleInput;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const scope = input.current.movieScope;
  if (scope === undefined)
    throw new Error(
      "Movie replacement installation has no exact edition scope",
    );
  let expected = input.original;
  let id = z
    .object({ movieReplacementV2: z.object({ replacementId: z.uuid() }) })
    .parse(expected.matchingEvidence).movieReplacementV2.replacementId;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(id) || seen.size >= 20)
      throw new Error(
        "Movie caption replacement ancestry exceeds its native bound",
      );
    seen.add(id);
    const record = requireExpectedReplacement(
      await readMovieReplacementReceiptV2(tx, id, budget),
      scope,
      expected,
    );
    const source = record.snapshot.source;
    if (source.kind === "replacement_v2") {
      const parent = await readMovieReplacementReceiptV2(
        tx,
        source.replacementId,
        budget,
      );
      if (
        parent === null ||
        parent.row.receipt?.id !== source.receiptId ||
        parent.receiptHash !== source.receiptHash
      )
        throw new Error("Movie replacement predecessor receipt changed");
      expected = NativeSubtitleSnapshotSchema.parse(record.snapshot.old);
      id = source.replacementId;
      continue;
    }
    if (source.kind !== "installation_v4")
      throw new Error(
        "Additional movie caption requires its actual original installation",
      );
    const installed = await readMovieSubtitleReceiptV4(
      tx,
      source.input,
      budget,
    );
    if (
      installed === null ||
      hash(installed) !== source.receiptHash ||
      hash(installed.after) !== hash(record.snapshot.old)
    )
      throw new Error("Movie replacement lost its original installed caption");
    const current = input.current;
    const lineage = await terminalSubtitleChain(
      tx,
      {
        subtitleId: installed.after.id,
        checksum: z.string().parse(installed.after.checksum),
        canonicalPath: z.string().parse(installed.after.path),
        libraryKind: current.video.libraryKind,
        movieScope: scope,
        asset: {
          id: current.subtitle.assetId,
          path: current.video.path,
          checksum: current.video.checksum,
          version: current.subtitle.videoVersion,
          ownershipEpoch: current.subtitle.ownershipEpoch,
          coverage: current.video.mediaIds.map((mediaId) => ({
            mediaId,
            current: true,
          })),
        },
        videoBindings: current.videoBindings,
        subtitleRenewals: current.chain.map((item) => ({
          bindings: item.binding.subtitles,
          snapshots: item.subtitleSnapshots,
        })),
      },
      budget,
    );
    if (hash(lineage.current) !== hash(current.subtitle))
      throw new Error(
        "Movie replacement installation has another current caption",
      );
    return {
      installation: {
        subtitleId: current.subtitle.id,
        journals: [
          {
            operationId: installed.journal.operationId,
            kind: installed.journal.kind,
            source: installed.journal.source,
            target: installed.journal.target,
            sha256: installed.journal.sha256,
            previousSha256: installed.journal.previousSha256,
          },
          ...lineage.journals,
        ],
      },
      history: {
        originalInstallation: installed,
        replacementHistory: lineage.history,
      },
      files: lineage.files,
      journals: lineage.journals,
      artifactIdentities: lineage.artifactIdentities,
    };
  }
}

function requireExpectedReplacement(
  record: Awaited<ReturnType<typeof readMovieReplacementReceiptV2>>,
  scope: MovieEditionScope,
  expected: NativeSubtitleSnapshot,
) {
  if (
    record === null ||
    record.row.receipt?.outcome !== "installed" ||
    hash(record.snapshot.scope) !== hash(scope) ||
    hash(record.receipt.after.candidate) !== hash(expected)
  )
    throw new Error(
      "Movie replacement candidate has no exact settled ancestry",
    );
  return record;
}
