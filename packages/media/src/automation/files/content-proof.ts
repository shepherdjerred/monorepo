import { ContentProof } from "#filesystem/content-proof.ts";
import { safePath, verifyControlExclusion } from "#filesystem/operations-io.ts";
import type { FileContext, FilePlanEntry, RemovalEntry } from "./types.ts";

export type ContentReference = {
  libraryKind: "movies" | "tv";
  root: "library" | "control";
  path: string;
};

/** Hash before PG locks. Final operations only accept exact stat proofs from this process. */
export async function prepareContentProof(
  context: FileContext,
  references: readonly ContentReference[],
): Promise<FileContext> {
  const contentProof = new ContentProof();
  for (const reference of references) {
    const roots = context.roots[reference.libraryKind];
    await verifyControlExclusion(roots, context.verifyPlexExclusion);
    const path = await safePath(roots[reference.root], reference.path, true);
    await contentProof.capture(path, async () => {
      await context.checkpoint("content-proof-hashing");
    });
  }
  contentProof.seal();
  await context.checkpoint("content-proof-ready");
  return { ...context, contentProof };
}

export async function preparePublicationProof(
  context: FileContext,
  plan: readonly FilePlanEntry[],
  rollbackOperationId?: string,
): Promise<FileContext> {
  const references: ContentReference[] = [];
  for (const entry of plan) {
    const add = (root: ContentReference["root"], path: string) =>
      references.push({ libraryKind: entry.libraryKind, root, path });
    add("library", entry.libraryPath);
    add("control", `staging/${entry.operationId}`);
    add("control", `rollback/${entry.operationId}`);
    add("control", `quarantine/${entry.assetId}`);
    for (const operation of [
      `recover-${entry.assetId}`,
      ...(rollbackOperationId === undefined
        ? []
        : [`${rollbackOperationId}-rollback-${entry.assetId}`]),
    ]) {
      add("control", `rollback/${operation}`);
      add("control", `staging/${operation}`);
    }
    for (const sidecar of entry.previousSidecars) {
      add("library", sidecar.libraryPath);
      add("control", `quarantine/${sidecar.quarantineId}`);
    }
  }
  return await prepareContentProof(context, references);
}

export async function prepareRemovalProof(
  context: FileContext,
  plan: readonly RemovalEntry[],
): Promise<FileContext> {
  return await prepareContentProof(
    context,
    plan.flatMap((entry) =>
      [entry, ...entry.sidecars].flatMap((file): ContentReference[] => [
        {
          libraryKind: entry.libraryKind,
          root: "library",
          path: file.libraryPath,
        },
        {
          libraryKind: entry.libraryKind,
          root: "control",
          path: `quarantine/${file.quarantineId}`,
        },
      ]),
    ),
  );
}
