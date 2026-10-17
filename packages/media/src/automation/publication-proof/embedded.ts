import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { FileGuardError, type FilePlanEntry } from "#automation/files/types.ts";
import { prepareContentProof } from "#automation/files/content-proof.ts";
import { publicationReferences } from "./participants.ts";
import type { PublicationContext } from "./invocation.ts";
import {
  preparePublicationSubtitleLineages,
  recordedSubtitleDependencies,
  assertRecordedSubtitleDependencies,
  type PreparedSubtitleLineages,
  type prepareSubtitleLineage,
} from "./subtitle-lineage.ts";
import { loadPublicationIntent } from "#infrastructure/publication-proof/store.ts";
import type { ContentProof } from "#filesystem/content-proof.ts";

/** Hash and retain exact extracted text outside PG; final writes use only this invocation's bytes. */
export async function prepareRecordedPublicationProof(
  context: PublicationContext,
  plan: readonly FilePlanEntry[],
  attemptId: string,
): Promise<PublicationContext> {
  const existing = await loadPublicationIntent(context.db, attemptId);
  const lineages: PreparedSubtitleLineages =
    existing === null
      ? await preparePublicationSubtitleLineages(context, plan)
      : new Map<string, Awaited<ReturnType<typeof prepareSubtitleLineage>>>();
  const dependencies =
    existing === null
      ? undefined
      : recordedSubtitleDependencies(existing.intent);
  const prepared = await prepareContentProof(context, [
    ...publicationReferences(plan),
    ...[...lineages.values()].flatMap((item) => item.references),
    ...(dependencies?.references ?? []),
  ]);
  const proof = prepared.contentProof;
  if (proof === undefined)
    throw new Error("Prepared publication content proof missing");
  if (existing !== null)
    await assertRecordedSubtitleDependencies(context, proof, existing.intent);
  const contents = await prepareEmbeddedContent(context, plan, proof);
  return {
    ...prepared,
    execution: context.execution,
    preparedEmbedded: contents,
    preparedSubtitleLineages: lineages,
    ...(dependencies === undefined
      ? {}
      : { publicationDependencies: dependencies }),
  };
}

async function prepareEmbeddedContent(
  context: PublicationContext,
  plan: readonly FilePlanEntry[],
  proof: ContentProof,
) {
  const contents = new Map<
    string,
    { path: string; checksum: string; bytes: Uint8Array }
  >();
  for (const entry of plan)
    for (const subtitle of entry.embeddedSubtitles) {
      await context.checkpoint("publication-embedded-content");
      const filename = path.join(
        context.roots[entry.libraryKind].control,
        subtitle.relativePath,
      );
      if ((await proof.digest(filename)) !== subtitle.checksum)
        throw new FileGuardError("embedded_content_changed");
      const bytes = await readFile(filename);
      if (
        createHash("sha256").update(bytes).digest("hex") !==
          subtitle.checksum ||
        (await proof.digest(filename)) !== subtitle.checksum
      )
        throw new FileGuardError("embedded_content_changed");
      if (contents.has(subtitle.id))
        throw new FileGuardError("embedded_identity_duplicate");
      contents.set(subtitle.id, {
        path: filename,
        checksum: subtitle.checksum,
        bytes,
      });
      await context.checkpoint("publication-embedded-content");
    }
  return contents;
}
