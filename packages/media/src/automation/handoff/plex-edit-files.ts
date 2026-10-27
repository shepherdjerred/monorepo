import path from "node:path";
import { z } from "zod";
import type { PublicationExecution } from "#automation/publication-proof/invocation.ts";
import { publicationInvocation } from "#automation/publication-proof/invocation.ts";
import { FileOperations } from "#filesystem/operations.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  lockLibraryPlexEditAuthority,
  freshHandoffNetworkV3,
} from "#infrastructure/handoff/plex-edit-authority.ts";
import {
  LibraryPlexEditOperationV3Schema,
  LibraryPlexFileProofV1Schema,
} from "#shared/handoff/library-v3.ts";
import type { LibraryPlexEditOperationV3 } from "#shared/handoff/library-v3.ts";
import { HandoffFileEvidenceSchema } from "#shared/handoff.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { prepareHandoffFiles, type HandoffFileContext } from "./files.ts";

const ReviewedFiles = HandoffFileEvidenceSchema.pick({
  planId: true,
  recoveryEpoch: true,
  workerPodUid: true,
  files: true,
});

/** A read-only Files Activity proves the selected original bytes; no physical ownership is granted. */
export async function prepareLibraryPlexEditFileV3(
  initial: HandoffFileContext,
  raw: LibraryPlexEditOperationV3,
  execution: PublicationExecution,
) {
  execution.assertActive();
  execution.signal.throwIfAborted();
  const input = LibraryPlexEditOperationV3Schema.parse(raw);
  const context = {
    ...initial,
    files: publicationInvocation(initial.files, execution),
  };
  const db = context.files.db;
  const budget = new PublicationAuthorityReadBudget();
  await db.$transaction((tx) =>
    lockLibraryPlexEditAuthority(tx, input, budget),
  );
  const prepared = await prepareHandoffFiles(
    context,
    input.planId,
    input.assetId,
  );
  execution.assertActive();
  return db.$transaction(
    async (tx) => {
      const authority = await lockLibraryPlexEditAuthority(tx, input, budget);
      const expected = ReviewedFiles.parse(authority.finished.files);
      const current = prepared.evidence.files[0];
      const reviewed = expected.files.find(
        (file) => file.assetId === input.assetId,
      );
      if (
        current === undefined ||
        reviewed === undefined ||
        prepared.evidence.files.length !== 1 ||
        expected.planId !== input.planId ||
        expected.recoveryEpoch !== authority.runtime.recoveryEpoch ||
        expected.workerPodUid !== context.workerPodUid ||
        identityHash(current) !== identityHash(reviewed)
      )
        throw new Error(
          "Plex edition correction file changed after owner review",
        );
      const network = await freshHandoffNetworkV3(
        tx,
        { planId: input.planId, epoch: authority.runtime.recoveryEpoch },
        budget,
      );
      const roots = context.files.roots.movies;
      if (
        network.evidence.mounts.bindings.filter(
          (binding) =>
            binding.canonical.root === roots.library &&
            binding.canonical.podUid === context.workerPodUid,
        ).length !== 1
      )
        throw new Error("Plex edition file proof executing storage changed");
      const verified = await prepared.content.verifiedFile(
        current.canonicalPath,
      );
      const capturedAt = new Date();
      const expiresAt = new Date(
        Math.min(
          capturedAt.getTime() + 90_000,
          execution.expiresAtMs,
          network.row.expiresAt.getTime(),
        ),
      );
      const evidence = LibraryPlexFileProofV1Schema.parse({
        ...input,
        schemaVersion: 1,
        planHash: authority.plan.planHash,
        recoveryEpoch: authority.runtime.recoveryEpoch,
        workerPodUid: context.workerPodUid,
        file: current,
        networkObservation: {
          id: network.row.id,
          evidenceHash: network.row.evidenceHash,
        },
        readObservedAt: new Date(execution.observed.wall).toISOString(),
        readSdkExpiresAt: new Date(execution.expiresAtMs).toISOString(),
        capturedAt: capturedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      const files = new FileOperations(roots, {
        authorize: () =>
          Promise.reject(new Error("Plex edition proof cannot mutate files")),
        ...(context.files.verifyPlexExclusion === undefined
          ? {}
          : { verifyPlexExclusion: context.files.verifyPlexExclusion }),
      });
      return files.withFileIdentity(
        {
          ...verified,
          libraryPath: path.relative(roots.library, current.canonicalPath),
        },
        async () => {
          execution.assertActive();
          execution.signal.throwIfAborted();
          if (expiresAt.getTime() <= Date.now())
            throw new Error("Plex edition file proof expired before commit");
          const row = await tx.mediaHandoffObservation.create({
            data: {
              planId: input.planId,
              kind: "plex_edit_files_v1",
              evidence: z
                .record(z.string(), z.json())
                .parse(nativeJson(evidence)),
              evidenceHash: identityHash(evidence),
              observedAt: capturedAt,
              expiresAt,
            },
          });
          return { id: row.id, evidenceHash: row.evidenceHash };
        },
      );
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}
