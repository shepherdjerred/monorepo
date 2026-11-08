import type {
  PublicationSubtitleLineage,
  PublicationSubtitleEvidence,
} from "#shared/publication-proof/subtitle-lineage.ts";
import type { PublicationAssetSnapshot } from "#shared/publication-proof/intent.ts";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { PublicationEntryIntent } from "#shared/publication-proof/intent.ts";
import { NativeTerminalDependencySchema } from "#shared/native-recovery/terminal.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";

const Journal = NativeTerminalDependencySchema.shape.journals.element.extend({
  version: z.literal(1),
  phase: z.enum(["prepared", "staged", "complete"]),
});
const digest = (value: unknown) => snapshotHash(nativeJson(value));

/** Validate immutable descriptor-derived evidence without consulting later mutable caption rows. */
export function assertPublicationSubtitleEvidence(
  item: PublicationEntryIntent,
): void {
  const lineage = item.originalGrant?.subtitleLineage;
  const evidence = item.subtitleEvidence;
  if (lineage === undefined) {
    if (evidence !== undefined)
      throw new Error("Publication caption evidence has no exact lineage");
    return;
  }
  if (
    evidence?.lineageHash !== digest(lineage) ||
    item.predecessor === null ||
    lineage.currentHash !== digest(item.predecessor.subtitles)
  )
    throw new Error("Publication caption evidence binding changed");
  assertArtifacts(lineage, evidence, item.predecessor);
  const original = item.journals.find(
    (journal) => journal.path === `journal/${item.entry.operationId}.json`,
  );
  if (original === undefined)
    throw new Error("Publication caption original import journal missing");
  const originalManifest = Journal.parse(JSON.parse(original.raw));
  const library = path.resolve(
    originalManifest.target,
    ...item.entry.libraryPath.split("/").map(() => ".."),
  );
  if (path.join(library, item.entry.libraryPath) !== originalManifest.target)
    throw new Error("Publication caption original library identity changed");
  const journalParent = original.identity.ancestors[0];
  if (
    journalParent === undefined ||
    path.basename(journalParent.path) !== "journal"
  )
    throw new Error("Publication caption original control identity missing");
  const control = path.dirname(journalParent.path);
  const canonical = `/data/${item.entry.libraryKind}`;
  const resolve = (name: string, source = false) => {
    for (const [prefix, root] of [
      [`${canonical}/.media-control`, control],
      [canonical, library],
    ]) {
      if (
        prefix !== undefined &&
        root !== undefined &&
        name.startsWith(prefix + "/")
      ) {
        const relative = path.relative(prefix, name);
        if (relative.startsWith("../") || path.isAbsolute(relative))
          throw new Error("Publication caption path escaped its root");
        return path.join(root, relative);
      }
    }
    const relative = path.relative(control, name);
    if (
      source &&
      name.startsWith(control + "/") &&
      relative.length > 0 &&
      !relative.startsWith("../") &&
      !path.isAbsolute(relative) &&
      path.join(control, relative) === name
    )
      return name;
    throw new Error(
      "Publication caption journal path has no exact recorded root",
    );
  };
  const journals = evidence.journals.map((journal) => {
    if (
      createHash("sha256").update(journal.raw).digest("hex") !==
        journal.sha256 ||
      Buffer.byteLength(journal.raw).toString() !== journal.sizeBytes ||
      digest(journal.identity.ancestors) !== digest(original.identity.ancestors)
    )
      throw new Error("Publication caption raw journal identity changed");
    const manifest = Journal.parse(JSON.parse(journal.raw));
    if (
      manifest.phase !== "complete" ||
      journal.path !== `journal/${manifest.operationId}.json`
    )
      throw new Error(
        "Publication caption journal is not an exact completed effect",
      );
    return manifest;
  });
  const used = new Set<string>();
  const match = (
    expected: z.infer<
      typeof NativeTerminalDependencySchema
    >["journals"][number],
  ) =>
    journals.filter(
      (journal) =>
        journal.operationId === expected.operationId &&
        journal.kind === expected.kind &&
        journal.source === resolve(expected.source, true) &&
        journal.target === resolve(expected.target) &&
        journal.sha256 === expected.sha256 &&
        journal.previousSha256 === expected.previousSha256,
    );
  for (const candidates of [
    ...lineage.journals.map((journal) => [journal]),
    ...lineage.installations.map((installation) => installation.journals),
  ]) {
    const matches = candidates.flatMap((candidate) => match(candidate));
    const actual = matches[0];
    if (
      actual === undefined ||
      matches.length !== 1 ||
      used.has(actual.operationId)
    )
      throw new Error(
        "Publication caption requires one exact journal per dependency",
      );
    used.add(actual.operationId);
  }
  if (used.size !== journals.length)
    throw new Error(
      "Publication caption journal set contains unrelated evidence",
    );
}

function assertArtifacts(
  lineage: PublicationSubtitleLineage,
  evidence: PublicationSubtitleEvidence,
  predecessor: PublicationAssetSnapshot,
) {
  if (
    evidence.files.length !== lineage.files.length ||
    new Set(evidence.files.map((file) => file.canonicalPath)).size !==
      evidence.files.length
  )
    throw new Error("Publication caption artifact coverage changed");
  for (const expected of lineage.files) {
    const actual = evidence.files.find(
      (file) => file.canonicalPath === expected.canonicalPath,
    );
    if (actual?.sha256 !== expected.expectedChecksum)
      throw new Error("Publication caption artifact binding changed");
  }
  for (const expected of lineage.artifactIdentities) {
    const actual = evidence.files.find(
      (file) => file.canonicalPath === expected.canonicalPath,
    );
    if (
      actual?.identity == null ||
      digest({
        device: actual.identity.device,
        inode: actual.identity.inode,
        mtimeNs: actual.identity.mtimeNs,
        checksum: actual.sha256,
      }) !==
        digest({
          device: expected.identity.device,
          inode: expected.identity.inode,
          mtimeNs: expected.identity.mtimeNs,
          checksum: expected.identity.checksum,
        })
    )
      throw new Error(
        "Publication replacement artifact receipt identity changed",
      );
  }
  const retained = lineage.files
    .filter((file) => file.expectedChecksum !== null)
    .map((file) => file.canonicalPath)
    .sort();
  const identities = lineage.artifactIdentities
    .map((file) => file.canonicalPath)
    .sort();
  if (
    new Set(identities).size !== identities.length ||
    digest(retained) !== digest(identities)
  )
    throw new Error(
      "Publication replacement artifact identity coverage changed",
    );
  if (
    new Set(lineage.replacements.map((replacement) => replacement.beforeId))
      .size !== lineage.replacements.length ||
    new Set(lineage.replacements.map((replacement) => replacement.afterId))
      .size !== lineage.replacements.length ||
    lineage.replacements.some(
      (replacement) =>
        !predecessor.subtitles.some(
          (subtitle) => subtitle.id === replacement.afterId,
        ),
    )
  )
    throw new Error("Publication replacement caption mapping changed");
}
