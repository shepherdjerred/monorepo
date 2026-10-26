import path from "node:path";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { captureNativeReviewProof } from "#automation/native-recovery/plex-proof.ts";
import { z } from "zod";
import { ContentProof } from "#filesystem/content-proof.ts";
import { safePath } from "#filesystem/operations-io.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";
import { FileOperations } from "#filesystem/operations.ts";
import {
  inspectHandoffJournals,
  verifyJournalProof,
  type JournalProof,
} from "#automation/handoff/journals.ts";
import {
  NativeArchiveScopeSchema,
  NativeArchiveNetworkEvidenceSchema,
  NativeArchiveFileEvidenceSchema,
  type NativeArchiveScope,
} from "#shared/native-recovery/archive.ts";
import { NativeTerminalEvidenceSchema } from "#shared/native-recovery/terminal.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { assertNativeEvidenceFresh } from "#automation/native-recovery/authority.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  archiveAwait,
  assertArchiveActive,
  type ArchiveFileContext,
} from "./execution.ts";
import {
  archiveAllPaths,
  archiveAbsentPaths,
  archiveOriginalJournals,
} from "./paths.ts";
import {
  captureArchiveSubtitles,
  archiveSubtitleEvidence,
  assertArchiveNeighbors,
} from "./subtitle-proof.ts";
import {
  captureArchiveAuthority,
  assertArchiveAuthorityProof,
  archiveSubtitleAuthorityEvidence,
} from "./authority-proof.ts";
import {
  captureArchiveSupersessions,
  archiveSupersessionEvidence,
} from "./supersession-proof.ts";

export async function prepareNativeArchiveFiles(
  context: ArchiveFileContext,
  input: { planId: string; operationId: string },
) {
  const budget = new PublicationAuthorityReadBudget();
  await context.files.checkpoint("native-archive-prepare");
  const plan = await archiveAwait(
    context.execution,
    context.files.db.nativeRecoveryPlan.findUniqueOrThrow({
      where: { id: input.planId },
    }),
  );
  budget.consume(1);
  const operation = await archiveAwait(
    context.execution,
    context.files.db.operation.findUniqueOrThrow({
      where: { id: input.operationId },
    }),
  );
  budget.consume(1);
  const command = z
    .object({ planId: z.uuid(), recoveryEpoch: z.int() })
    .parse(operation.payload);
  if (
    !["preparing", "applying"].includes(plan.state) ||
    operation.kind !==
      (plan.state === "preparing"
        ? "prepare_native_archive"
        : "apply_native_archive") ||
    operation.targetId !== plan.id ||
    operation.userId !== plan.actorId ||
    command.planId !== plan.id ||
    command.recoveryEpoch !== plan.recoveryEpoch
  )
    throw new Error("Archive physical preparation command changed");
  const scope = NativeArchiveScopeSchema.parse(plan.scope);
  const plex = await captureNativeReviewProof(context.files, input, plan.plan, {
    execution: context.execution,
    budget,
    expiresAtMs: context.execution.expiresAtMs,
  });
  const network = NativeArchiveNetworkEvidenceSchema.parse(plex.network);
  if (
    network.planId !== plan.id ||
    network.recoveryEpoch !== plan.recoveryEpoch ||
    Date.parse(network.expiresAt) <= Date.now()
  )
    throw new Error("Archive network evidence changed");
  assertNativeEvidenceFresh(network);
  const content = new ContentProof();
  const authorityProof = await captureArchiveAuthority(
    context,
    scope,
    content,
    plex.budget,
  );
  const supersessions = await captureArchiveSupersessions(
    context,
    scope,
    content,
    authorityProof.budget,
  );
  const journals: JournalProof[] = [];
  const measured = [];
  const canonicalPaths = archiveAllPaths(scope);
  if (
    new Set(canonicalPaths.map((name) => nativeLocalPath(context, name)))
      .size !== canonicalPaths.length
  )
    throw new Error("Archive local path mapping collides");
  for (const kind of ["movies", "tv"] as const) {
    const captured = await captureArchiveRoot(context, {
      kind,
      network,
      scope,
      content,
      canonicalPaths,
    });
    journals.push(captured.journal);
    measured.push(...captured.measured);
  }
  await assertArchiveNeighbors(context, scope);
  await verifyArchiveOriginalJournals(context, scope);
  content.seal();
  await assertArchiveAuthorityProof(
    context,
    content,
    authorityProof.participants,
  );
  const subtitleEvidence = await archiveSubtitleAuthorityEvidence(
    context,
    content,
    authorityProof,
  );
  const supersessionEvidence = await archiveSupersessionEvidence(
    context,
    content,
    supersessions,
  );
  const files = await measuredArchiveEvidence(context, content, measured);
  const artifactAbsences = [];
  for (const name of archiveAbsentPaths(scope)) {
    const absence = await content.reviewAbsence(nativeLocalPath(context, name));
    artifactAbsences.push({
      canonicalPath: name,
      absentAncestors: absence.ancestors,
    });
  }
  const terminalEvidence = await archiveTerminalEvidence(
    context,
    scope,
    content,
    journals,
  );
  for (const journal of journals) await verifyJournalProof(journal);
  assertArchiveActive(context.execution);
  const evidence = NativeArchiveFileEvidenceSchema.parse({
    schemaVersion: 2,
    lifecycleKind: "superseded_archive",
    planId: plan.id,
    recoveryEpoch: plan.recoveryEpoch,
    workerPodUid: context.workerPodUid,
    capturedAt: new Date().toISOString(),
    files,
    terminalEvidence,
    artifactAbsences,
    ...(scope.supersessions === undefined ? {} : { supersessionEvidence }),
    ...(subtitleEvidence.length === 0 ? {} : { subtitleEvidence }),
  });
  plex.freshness.assertActive();
  return {
    scope,
    content,
    journals,
    evidence,
    authorityProof,
    supersessions,
    plex,
  };
}
export type PreparedNativeArchive = Awaited<
  ReturnType<typeof prepareNativeArchiveFiles>
>;

async function captureArchiveRoot(
  context: ArchiveFileContext,
  input: {
    kind: "movies" | "tv";
    network: z.infer<typeof NativeArchiveNetworkEvidenceSchema>;
    scope: NativeArchiveScope;
    content: ContentProof;
    canonicalPaths: string[];
  },
) {
  const { kind, network, scope, content, canonicalPaths } = input;
  if (context.files.verifyPlexExclusion === undefined)
    throw new Error("Archive proof requires both exclusion proofs");
  await archiveAwait(
    context.execution,
    context.files.verifyPlexExclusion(context.files.roots[kind]),
  );
  if (
    network.mounts.mounts.find((mount) => mount.root === `/data/${kind}`)
      ?.podUid !== context.workerPodUid
  )
    throw new Error("Archive proof belongs to another files executor");
  const selected = canonicalPaths.filter((name) =>
    name.startsWith(`/data/${kind}/`),
  );
  const roots = context.files.roots[kind];
  await safePath(roots.control, "locks/native-archive.lock", true);
  const targets = new Set(
    selected.map((name) => nativeLocalPath(context, name)),
  );
  const journal = await archiveAwait(
    context.execution,
    inspectHandoffJournals(roots.control, targets),
  );
  for (const name of selected) {
    const local = nativeLocalPath(context, name);
    const root = name.startsWith(`/data/${kind}/.media-control/`)
      ? roots.control
      : roots.library;
    await safePath(root, path.relative(root, local), true);
    await content.capture(local, () =>
      context.files.checkpoint("native-archive-hashing"),
    );
  }
  const measured = [];
  for (const file of scope.files.filter(
    (entry) => entry.libraryKind === kind,
  )) {
    const probe = await archiveAwait(
      context.execution,
      (context.files.inspect ?? inspectMedia)(
        nativeLocalPath(context, file.canonicalPath),
      ),
    );
    if (!probe.streams.some((stream) => stream.codec_type === "video"))
      throw new Error("Archive file has no measured video stream");
    measured.push({
      file,
      properties: z.json().parse(probe),
      journalDigest: journal.digest,
      captured: await captureArchiveSubtitles(context, file, content, probe),
    });
  }
  return { journal, measured };
}

async function measuredArchiveEvidence(
  context: ArchiveFileContext,
  content: ContentProof,
  measured: Awaited<ReturnType<typeof captureArchiveRoot>>["measured"],
) {
  const files = [];
  const identities = new Set<string>();
  for (const item of measured) {
    const local = nativeLocalPath(context, item.file.canonicalPath);
    const proof = await content.verifiedFile(local);
    if (
      proof.sha256 !== item.file.checksum ||
      proof.sizeBytes !== item.file.sizeBytes
    )
      throw new Error("Archive content differs from its committed version");
    const subtitles = await archiveSubtitleEvidence(
      context,
      content,
      item.captured,
    );
    const identity = await content.reviewIdentity(local);
    for (const itemIdentity of [
      identity,
      ...subtitles.flatMap((subtitle) =>
        subtitle.identity === null ? [] : [subtitle.identity],
      ),
    ]) {
      const key = `${itemIdentity.device}:${itemIdentity.inode}`;
      if (identities.has(key))
        throw new Error("Archive physical participants share an inode");
      identities.add(key);
    }
    files.push({
      assetId: item.file.assetId,
      canonicalPath: item.file.canonicalPath,
      checksum: proof.sha256,
      sizeBytes: proof.sizeBytes,
      identity,
      properties: item.properties,
      journalDigest: item.journalDigest,
      subtitles,
      sidecarInventory: [],
    });
  }
  return files;
}

export async function verifyArchiveOriginalJournals(
  context: ArchiveFileContext,
  scope: NativeArchiveScope,
) {
  for (const expected of archiveOriginalJournals(context, scope)) {
    const kind = (["movies", "tv"] as const).find(
      (candidateKind) =>
        expected.target.startsWith(
          context.files.roots[candidateKind].control + path.sep,
        ) ||
        expected.target.startsWith(
          context.files.roots[candidateKind].library + path.sep,
        ),
    );
    if (kind === undefined) throw new Error("Archive journal root is unbound");
    const operations = new FileOperations(context.files.roots[kind], {
      authorize: () =>
        Promise.reject(new Error("Archive inspection cannot mutate files")),
      ...(context.files.verifyPlexExclusion === undefined
        ? {}
        : { verifyPlexExclusion: context.files.verifyPlexExclusion }),
    });
    const actual = await archiveAwait(
      context.execution,
      operations.readManifest(expected.operationId),
    );
    if (snapshotHash(actual) !== snapshotHash(expected))
      throw new Error(
        "Archive journal does not prove its exact adjacent publication",
      );
  }
}

async function archiveTerminalEvidence(
  context: ArchiveFileContext,
  scope: NativeArchiveScope,
  content: ContentProof,
  journals: JournalProof[],
) {
  const result = [];
  for (const item of scope.terminalDependencies) {
    const files = [];
    for (const file of item.dependency.files) {
      const local = nativeLocalPath(context, file.canonicalPath);
      const digest = await content.digest(local);
      if (digest !== file.expectedChecksum)
        throw new Error(
          "Archive terminal dependency content contradicts its receipt",
        );
      const absence =
        digest === null ? await content.reviewAbsence(local) : null;
      files.push({
        canonicalPath: file.canonicalPath,
        sha256: digest,
        identity: digest === null ? null : await content.reviewIdentity(local),
        absentAncestors: absence?.ancestors ?? [],
      });
    }
    result.push(
      NativeTerminalEvidenceSchema.parse({
        cleanupId: item.dependency.cleanupId,
        kind: item.dependency.kind,
        journalDigest: snapshotHash(journals.map((journal) => journal.digest)),
        files,
      }),
    );
  }
  return result;
}
