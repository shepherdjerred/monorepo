import path from "node:path";
import type { FileContext, FilePlanEntry } from "#automation/files/types.ts";
import type { ContentReference } from "#automation/files/content-proof.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import { findPublicationOriginalGrant } from "#infrastructure/publication-proof/grants.ts";
import {
  inspectHandoffJournals,
  verifyJournalProof,
} from "#automation/handoff/journals.ts";
import {
  verifyInstallationJournal,
  verifyTerminalJournal,
  terminalFileEvidence,
} from "#automation/native-recovery/terminal-proof.ts";
import type { PublicationSubtitleLineage } from "#shared/publication-proof/subtitle-lineage.ts";
import { durablePublicationJournal } from "#filesystem/publication-proof/journal.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { PublicationSubtitleEvidenceSchema } from "#shared/publication-proof/subtitle-lineage.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import type { ContentProof } from "#filesystem/content-proof.ts";
import { assertPublicationJournalIdentity } from "#filesystem/publication-proof/journal.ts";
import type { PublicationIOIntent } from "#shared/publication-proof/io.ts";

export type PreparedSubtitleLineages = Awaited<
  ReturnType<typeof preparePublicationSubtitleLineages>
>;
export type PublicationDependencies = {
  references: ContentReference[];
  operations: { kind: "movies" | "tv"; id: string }[];
};

export function recordedSubtitleDependencies(
  intent: PublicationIOIntent,
): PublicationDependencies {
  const references: ContentReference[] = [];
  const operations = [];
  for (const item of intent.entries) {
    const lineage = item.originalGrant?.subtitleLineage;
    if (lineage === undefined) continue;
    references.push(
      ...subtitleLineageReferences(item.entry.libraryKind, lineage),
    );
    for (const journal of [
      ...lineage.journals,
      ...lineage.installations.flatMap((installation) => installation.journals),
    ])
      operations.push({
        kind: item.entry.libraryKind,
        id: journal.operationId,
      });
  }
  return { references, operations };
}

export async function assertRecordedSubtitleDependencies(
  context: FileContext,
  content: ContentProof,
  intent: PublicationIOIntent,
) {
  for (const entry of intent.entries) {
    const evidence = entry.subtitleEvidence;
    if (evidence === undefined) continue;
    for (const expected of evidence.files) {
      const actual = await terminalFileEvidence(
        { content, resolvePath: (name) => workerFilePath(context, name) },
        {
          canonicalPath: expected.canonicalPath,
          expectedChecksum: expected.sha256,
        },
      );
      if (
        snapshotHash(nativeJson(actual)) !== snapshotHash(nativeJson(expected))
      )
        throw new FileOperationConflict(
          "Recorded subtitle dependency identity changed",
        );
    }
    for (const journal of evidence.journals)
      await assertPublicationJournalIdentity(
        context.roots[entry.entry.libraryKind],
        journal,
      );
  }
}

export function subtitleLineageReferences(
  kind: "movies" | "tv",
  lineage: PublicationSubtitleLineage,
): ContentReference[] {
  const paths = lineage.files.map((file) => file.canonicalPath);
  const journals = [
    ...lineage.journals,
    ...lineage.installations.flatMap((item) => item.journals),
  ];
  paths.push(
    ...journals.map(
      (journal) =>
        `/data/${kind}/.media-control/journal/${journal.operationId}.json`,
    ),
  );
  return [...new Set(paths)].map((name) => {
    const control = `/data/${kind}/.media-control/`;
    const library = `/data/${kind}/`;
    if (!name.startsWith(library))
      throw new FileOperationConflict(
        "Subtitle lineage escapes its library root",
      );
    return {
      libraryKind: kind,
      root: name.startsWith(control) ? "control" : "library",
      path: name.slice(
        name.startsWith(control) ? control.length : library.length,
      ),
    };
  });
}

/** Immutable descriptor selection is reread under PG; all complete journal reads occur here, before locks. */
export async function preparePublicationSubtitleLineages(
  context: FileContext,
  plan: readonly FilePlanEntry[],
) {
  const prepared = new Map<
    string,
    Awaited<ReturnType<typeof prepareSubtitleLineage>>
  >();
  for (const entry of plan) {
    if (entry.previousAssetId === null) continue;
    const asset = await snapshotPublicationAsset(
      context.db,
      entry.previousAssetId,
    );
    const grant = await findPublicationOriginalGrant(context.db, {
      asset,
      libraryKind: entry.libraryKind,
    });
    if (grant?.subtitleLineage === undefined) continue;
    prepared.set(
      asset.id,
      await prepareSubtitleLineage(
        context,
        entry.libraryKind,
        grant.subtitleLineage,
      ),
    );
  }
  return prepared;
}

export async function prepareSubtitleLineage(
  context: FileContext,
  kind: "movies" | "tv",
  lineage: PublicationSubtitleLineage,
) {
  const resolvePath = (name: string) => {
    if (name.startsWith(`/data/${kind}/`)) return workerFilePath(context, name);
    const control = context.roots[kind].control;
    if (path.normalize(name) !== name || !name.startsWith(control + path.sep))
      throw new FileOperationConflict(
        "Subtitle lineage source escapes its trusted control root",
      );
    return name;
  };
  const descriptors = [
    ...lineage.journals,
    ...lineage.installations.flatMap((item) => item.journals),
  ];
  const journal = await inspectHandoffJournals(
    context.roots[kind].control,
    new Set(
      descriptors.flatMap((item) => [
        resolvePath(item.source),
        resolvePath(item.target),
      ]),
    ),
  );
  const input = { journals: [journal], resolvePath };
  const selected = [...lineage.journals];
  for (const descriptor of lineage.journals)
    await verifyTerminalJournal(input, descriptor);
  for (const installation of lineage.installations) {
    const match = await verifyInstallationJournal(input, installation.journals);
    const descriptor = installation.journals.find(
      (item) => item.operationId === match.operationId,
    );
    if (descriptor === undefined)
      throw new Error("Selected subtitle installation descriptor disappeared");
    selected.push(descriptor);
  }
  const observed = [];
  for (const descriptor of selected)
    observed.push(
      await durablePublicationJournal(context.roots[kind], {
        version: 1,
        ...descriptor,
        source: resolvePath(descriptor.source),
        target: resolvePath(descriptor.target),
        phase: "complete",
      }),
    );
  await verifyJournalProof(journal);
  return {
    lineage,
    kind,
    journal,
    observed,
    references: subtitleLineageReferences(kind, lineage),
    operationIds: descriptors.map((item) => item.operationId),
  };
}

/** Final proof consumes only cached hashes and fresh stat/ancestor identities. */
export async function publicationSubtitleEvidence(
  context: FileContext,
  content: ContentProof,
  prepared: Awaited<ReturnType<typeof prepareSubtitleLineage>>,
) {
  await verifyJournalProof(prepared.journal);
  for (const expected of prepared.lineage.artifactIdentities) {
    const file = await content.verifiedFile(
      workerFilePath(context, expected.canonicalPath),
    );
    const actual = {
      device: file.dev.toString(),
      inode: file.ino.toString(),
      mtimeNs: file.mtimeNs.toString(),
      sizeBytes: file.sizeBytes,
      checksum: file.sha256,
    };
    if (snapshotHash(actual) !== snapshotHash(expected.identity))
      throw new FileOperationConflict(
        "Subtitle replacement artifact differs from its immutable receipt",
      );
  }
  const files = [];
  for (const file of prepared.lineage.files)
    files.push(
      await terminalFileEvidence(
        { content, resolvePath: (name) => workerFilePath(context, name) },
        file,
      ),
    );
  for (const journal of prepared.observed)
    await assertPublicationJournalIdentity(
      context.roots[prepared.kind],
      journal,
    );
  return PublicationSubtitleEvidenceSchema.parse({
    lineageHash: snapshotHash(nativeJson(prepared.lineage)),
    files,
    journals: prepared.observed,
  });
}
