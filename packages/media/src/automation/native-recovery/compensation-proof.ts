import path from "node:path";
import {
  ManifestSchema,
  FileOperationConflict,
} from "#filesystem/operations-types.ts";
import type { ContentProof } from "#filesystem/content-proof.ts";
import type { NativePublishedScope } from "#shared/native-recovery/lifecycle.ts";
import type { FileContext } from "#automation/files/types.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import {
  prepareSubtitleLineage,
  publicationSubtitleEvidence,
  subtitleLineageReferences,
} from "#automation/publication-proof/subtitle-lineage.ts";

export async function prepareCompensationSubtitleLineages(
  context: FileContext,
  scope: NativePublishedScope,
) {
  const result = [];
  for (const dependency of dependencies(scope))
    for (const item of dependency.subtitleLineages ?? []) {
      const file = scope.files.find(
        (candidate) => candidate.assetId === item.assetId,
      );
      if (file === undefined)
        throw new Error("Settled subtitle lineage asset missing from scope");
      result.push({
        continuationId: dependency.continuationId,
        assetId: item.assetId,
        prepared: await prepareSubtitleLineage(
          context,
          file.libraryKind,
          item.lineage,
        ),
      });
    }
  return result;
}
export type CompensationSubtitleLineages = Awaited<
  ReturnType<typeof prepareCompensationSubtitleLineages>
>;

export function compensationSubtitleReferences(scope: NativePublishedScope) {
  return dependencies(scope).flatMap((dependency) =>
    (dependency.subtitleLineages ?? []).flatMap((item) => {
      const file = scope.files.find(
        (candidate) => candidate.assetId === item.assetId,
      );
      if (file === undefined)
        throw new Error("Settled subtitle lineage asset missing from scope");
      return subtitleLineageReferences(file.libraryKind, item.lineage);
    }),
  );
}
export function compensationSubtitleOperations(
  scope: NativePublishedScope,
  kind: "movies" | "tv",
) {
  return dependencies(scope).flatMap((dependency) =>
    (dependency.subtitleLineages ?? []).flatMap((item) =>
      scope.files.some(
        (file) => file.assetId === item.assetId && file.libraryKind === kind,
      )
        ? [
            ...item.lineage.journals,
            ...item.lineage.installations.flatMap(
              (installation) => installation.journals,
            ),
          ].map((journal) => journal.operationId)
        : [],
    ),
  );
}

function dependencies(scope: NativePublishedScope) {
  return scope.schemaVersion === 2 ? (scope.settledCompensations ?? []) : [];
}
function retainedPath(
  item: ReturnType<typeof dependencies>[number]["retainedArtifacts"][number],
) {
  return `/data/${item.libraryKind}${item.physical.root === "control" ? "/.media-control" : ""}/${item.physical.path}`;
}
export function compensationDependencyJournals(
  scope: NativePublishedScope,
  roots: FileContext["roots"],
) {
  return dependencies(scope).flatMap((dependency) =>
    dependency.journals.map((journal) => {
      const manifest = ManifestSchema.parse(JSON.parse(journal.raw));
      const kinds = (["movies", "tv"] as const).filter((kind) =>
        [roots[kind].library, roots[kind].control].some((root) =>
          manifest.target.startsWith(root + path.sep),
        ),
      );
      if (kinds.length !== 1 || kinds[0] === undefined)
        throw new FileOperationConflict(
          "Settled compensation journal has ambiguous worker roots",
        );
      return {
        ...journal,
        libraryKind: kinds[0],
        operationId: manifest.operationId,
        canonicalPath: `/data/${kinds[0]}/.media-control/${journal.path}`,
      };
    }),
  );
}
export function compensationDependencyPaths(
  scope: NativePublishedScope,
  roots: FileContext["roots"],
) {
  return [
    ...new Set([
      ...dependencies(scope).flatMap((item) =>
        item.retainedArtifacts.map((artifact) => retainedPath(artifact)),
      ),
      ...compensationDependencyJournals(scope, roots).map(
        (item) => item.canonicalPath,
      ),
      ...compensationSubtitleReferences(scope).map(
        (item) =>
          `/data/${item.libraryKind}/${item.root === "control" ? ".media-control/" : ""}${item.path}`,
      ),
    ]),
  ].sort();
}

/** Audit dependencies only: these exact retained artifacts receive no deletion or ownership grant. */
type CompensationEvidenceInput = {
  scope: NativePublishedScope;
  content: ContentProof;
  roots: FileContext["roots"];
  resolvePath: (canonical: string) => string;
  subtitleLineages: CompensationSubtitleLineages;
  context: FileContext;
};

async function assertRetainedArtifacts(
  input: CompensationEvidenceInput,
  dependency: ReturnType<typeof dependencies>[number],
) {
  for (const item of dependency.retainedArtifacts) {
    const filename = input.resolvePath(retainedPath(item));
    if (item.physical.state === "absent") {
      if (
        snapshotHash(await input.content.reviewAbsence(filename)) !==
        snapshotHash({ ancestors: item.physical.ancestors })
      )
        throw new FileOperationConflict(
          "Settled compensation artifact absence changed",
        );
    } else {
      const proof = await input.content.verifiedFile(filename);
      if (
        proof.sha256 !== item.physical.sha256 ||
        proof.sizeBytes !== item.physical.sizeBytes ||
        snapshotHash(
          nativeJson(await input.content.reviewIdentity(filename)),
        ) !== snapshotHash(nativeJson(item.physical.identity))
      )
        throw new FileOperationConflict(
          "Settled compensation retained artifact changed",
        );
    }
  }
}

export async function compensationDependencyEvidence(
  input: CompensationEvidenceInput,
) {
  const evidence = [];
  const journals = compensationDependencyJournals(input.scope, input.roots);
  for (const dependency of dependencies(input.scope)) {
    await assertRetainedArtifacts(input, dependency);
    for (const expected of dependency.journals) {
      const journal = journals.find(
        (item) =>
          item.path === expected.path && item.sha256 === expected.sha256,
      );
      if (journal === undefined)
        throw new Error("Settled compensation journal projection missing");
      const filename = input.resolvePath(journal.canonicalPath);
      const actual = await input.content.verifiedFile(filename);
      if (
        actual.sha256 !== expected.sha256 ||
        actual.sizeBytes !== expected.sizeBytes ||
        snapshotHash(
          nativeJson(await input.content.reviewIdentity(filename)),
        ) !== snapshotHash(nativeJson(expected.identity))
      )
        throw new FileOperationConflict(
          "Settled compensation journal identity changed",
        );
    }
    const subtitleEvidence = [];
    for (const item of input.subtitleLineages.filter(
      (candidate) => candidate.continuationId === dependency.continuationId,
    ))
      subtitleEvidence.push({
        assetId: item.assetId,
        evidence: await publicationSubtitleEvidence(
          input.context,
          input.content,
          item.prepared,
        ),
      });
    if (subtitleEvidence.length !== (dependency.subtitleLineages ?? []).length)
      throw new Error("Settled subtitle evidence set changed");
    evidence.push({
      continuationId: dependency.continuationId,
      descriptorHash: dependency.descriptorHash,
      completionHash: dependency.completionHash,
      physicalEvidenceHash: snapshotHash(
        nativeJson(dependency.retainedArtifacts),
      ),
      journalEvidenceHash: snapshotHash(nativeJson(dependency.journals)),
      ...(subtitleEvidence.length === 0 ? {} : { subtitleEvidence }),
    });
  }
  return evidence;
}
