import path from "node:path";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { settledEvidence } from "./settled-proof.ts";
import {
  compensationDependencyPaths,
  compensationDependencyEvidence,
  compensationDependencyJournals,
} from "./compensation-proof.ts";
import { inspectCompensationJournals } from "./compensation-journals.ts";
import {
  prepareCompensationSubtitleLineages,
  type CompensationSubtitleLineages,
} from "./compensation-proof.ts";
import { z } from "zod";
import {
  captureNativeReviewProof,
  type NativeFilesPlexProof,
} from "./plex-proof.ts";
import { requirePublicationExecution } from "#automation/publication-proof/invocation.ts";
import { ContentProof } from "#filesystem/content-proof.ts";
import { safePath } from "#filesystem/operations-io.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";
import type { FileContext } from "#automation/files/types.ts";
import { NativeRecoveryNetworkEvidenceSchema } from "#shared/native-recovery.ts";
import {
  NativePublishedScopeSchema,
  NativePublishedFileEvidenceSchema,
  type NativePublishedScope,
} from "#shared/native-recovery/lifecycle.ts";
import { terminalPaths, terminalEvidence } from "./terminal-proof.ts";
import {
  captureNativeSubtitles,
  nativeSubtitleEvidence,
} from "#automation/native-subtitles/proof.ts";
import {
  inspectHandoffJournals,
  type JournalProof,
} from "#automation/handoff/journals.ts";

export type NativeFileContext = { files: FileContext; workerPodUid: string };
export type PreparedNativeFiles = {
  plex: NativeFilesPlexProof;
  scope: NativePublishedScope;
  content: ContentProof;
  journals: JournalProof[];
  evidence: z.infer<typeof NativePublishedFileEvidenceSchema>;
  subtitleLineages: CompensationSubtitleLineages;
};

/** Canonical names remain stable; only trusted configured worker roots determine local IO. */
export function nativeLocalPath(
  context: NativeFileContext,
  canonical: string,
): string {
  if (context.files.pathMapping !== undefined)
    return context.files.pathMapping.local(canonical);
  for (const kind of ["movies", "tv"] as const) {
    const relative = path.relative(`/data/${kind}`, canonical);
    if (
      relative.length > 0 &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    )
      return relative.startsWith(".media-control/")
        ? path.join(
            context.files.roots[kind].control,
            relative.slice(".media-control/".length),
          )
        : path.join(context.files.roots[kind].library, relative);
  }
  throw new Error("Native proof path escapes approved canonical roots");
}

export async function prepareNativeFiles(
  context: NativeFileContext,
  input: { planId: string; operationId: string },
): Promise<PreparedNativeFiles> {
  const budget = new PublicationAuthorityReadBudget();
  const execution = requirePublicationExecution(
    context.files.publicationExecution?.(),
  );
  const { planId } = input;
  const plan = await context.files.db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: planId },
  });
  budget.consume(1);
  if (!["preparing", "applying"].includes(plan.state))
    throw new Error("Native proof requires a live owner command");
  const scope = NativePublishedScopeSchema.parse(plan.scope);
  const plex = await captureNativeReviewProof(context.files, input, plan.plan, {
    execution,
    budget,
  });
  const network = NativeRecoveryNetworkEvidenceSchema.parse(plex.network);
  if (
    network.planId !== planId ||
    network.recoveryEpoch !== plan.recoveryEpoch ||
    Date.parse(network.expiresAt) <= Date.now()
  )
    throw new Error("Native network evidence is stale");
  const content = new ContentProof();
  const subtitleLineages = await prepareCompensationSubtitleLineages(
    context.files,
    scope,
  );
  const journals: JournalProof[] = [];
  const measured = [];
  const resolvePath = (canonical: string) =>
    nativeLocalPath(context, canonical);
  if (
    new Set(scope.files.map((file) => resolvePath(file.canonicalPath))).size !==
    scope.files.length
  )
    throw new Error("Native local mapping collides");
  for (const kind of ["movies", "tv"] as const) {
    const roots = context.files.roots[kind];
    await verifyNativeRoot(context, network, kind);
    await safePath(roots.control, "locks/native-proof.lock", true);
    const selected = scope.files.filter((file) => file.libraryKind === kind);
    const settledJournals = compensationDependencyJournals(
      scope,
      context.files.roots,
    ).filter((journal) => journal.libraryKind === kind);
    const targets = selectedJournalPaths(scope, kind, resolvePath);
    const journal =
      settledJournals.length === 0
        ? await inspectHandoffJournals(roots.control, targets)
        : await inspectCompensationJournals(
            roots.control,
            targets,
            settledJournals,
          );
    journals.push(journal);
    for (const file of selected) {
      measured.push(
        await measureNativeFile(context, content, file, {
          journalDigest: journal.digest,
          resolvePath,
        }),
      );
    }
  }
  await captureTerminalPaths({ scope, content, resolvePath, context });
  for (const name of compensationDependencyPaths(scope, context.files.roots))
    await content.capture(resolvePath(name), () =>
      context.files.checkpoint("native-compensation-dependency-hashing"),
    );
  content.seal();
  const terminal = await terminalEvidence({
    scope,
    content,
    journals,
    resolvePath,
  });
  const settled = await settledEvidence({
    scope,
    content,
    journals,
    resolvePath,
  });
  const compensation = await compensationDependencyEvidence({
    scope,
    content,
    roots: context.files.roots,
    resolvePath,
    subtitleLineages,
    context: context.files,
  });
  const files = [];
  for (const item of measured) {
    const local = resolvePath(item.file.canonicalPath);
    const proof = await content.verifiedFile(local);
    if (
      proof.sha256 !== item.file.checksum ||
      proof.sizeBytes !== item.file.sizeBytes
    )
      throw new Error(
        "Native physical content differs from recorded publication",
      );
    files.push({
      assetId: item.file.assetId,
      canonicalPath: item.file.canonicalPath,
      checksum: proof.sha256,
      sizeBytes: proof.sizeBytes,
      identity: await content.reviewIdentity(local),
      properties: item.properties,
      journalDigest: item.journalDigest,
      subtitles: await nativeSubtitleEvidence(content, item.captured),
      sidecarInventory: [],
    });
  }
  plex.freshness.assertActive();
  return {
    plex,
    subtitleLineages,
    scope,
    content,
    journals,
    evidence: NativePublishedFileEvidenceSchema.parse({
      ...evidenceVersion(scope, terminal, settled),
      ...(scope.schemaVersion === 2 && scope.settledCompensations !== undefined
        ? { compensationEvidence: compensation }
        : {}),
      planId,
      recoveryEpoch: plan.recoveryEpoch,
      workerPodUid: context.workerPodUid,
      capturedAt: new Date().toISOString(),
      files,
    }),
  };
}

async function measureNativeFile(
  context: NativeFileContext,
  content: ContentProof,
  file: NativePublishedScope["files"][number],
  input: { journalDigest: string; resolvePath: (canonical: string) => string },
) {
  const roots = context.files.roots[file.libraryKind];
  const local = input.resolvePath(file.canonicalPath);
  if (
    (await safePath(
      roots.library,
      path.relative(roots.library, local),
      false,
    )) !== local
  )
    throw new Error("Native local file binding changed");
  await content.capture(local, () =>
    context.files.checkpoint("native-file-hashing"),
  );
  const probe = await (context.files.inspect ?? inspectMedia)(local);
  if (!probe.streams.some((stream) => stream.codec_type === "video"))
    throw new Error("Native file has no measured video stream");
  return {
    file,
    journalDigest: input.journalDigest,
    properties: z.json().parse(probe),
    captured: await captureNativeSubtitles({
      file,
      libraryRoot: roots.library,
      content,
      probe,
      checkpoint: () => context.files.checkpoint("native-subtitle-hashing"),
      resolvePath: input.resolvePath,
    }),
  };
}

async function captureTerminalPaths({
  scope,
  content,
  resolvePath,
  context,
}: {
  scope: NativePublishedScope;
  content: ContentProof;
  resolvePath: (name: string) => string;
  context: NativeFileContext;
}) {
  for (const name of terminalPaths(scope))
    await content.capture(resolvePath(name), () =>
      context.files.checkpoint("native-terminal-hashing"),
    );
}
function evidenceVersion(
  scope: NativePublishedScope,
  terminal: Awaited<ReturnType<typeof terminalEvidence>>,
  settled: Awaited<ReturnType<typeof settledEvidence>>,
) {
  return scope.schemaVersion === 1
    ? { schemaVersion: 1 }
    : {
        schemaVersion: 2,
        lifecycleKind: "published",
        terminalEvidence: terminal,
        ...(settled.length === 0 ? {} : { settledEvidence: settled }),
      };
}

function selectedJournalPaths(
  scope: NativePublishedScope,
  kind: "movies" | "tv",
  resolvePath: (canonical: string) => string,
) {
  return new Set([
    ...terminalPaths(scope)
      .filter((name) => name.startsWith(`/data/${kind}/`))
      .map((name) => resolvePath(name)),
    ...scope.files.flatMap((file) =>
      file.libraryKind === kind
        ? [
            resolvePath(file.canonicalPath),
            ...file.subtitles.flatMap((subtitle) =>
              subtitle.path === null ? [] : [resolvePath(subtitle.path)],
            ),
          ]
        : [],
    ),
  ]);
}

async function verifyNativeRoot(
  context: NativeFileContext,
  network: z.infer<typeof NativeRecoveryNetworkEvidenceSchema>,
  kind: "movies" | "tv",
) {
  if (context.files.verifyPlexExclusion === undefined)
    throw new Error(
      "Native recovery requires current Plex exclusion proof for both roots",
    );
  await context.files.verifyPlexExclusion(context.files.roots[kind]);
  const mount = network.mounts.mounts.find(
    (item) => item.root === `/data/${kind}`,
  );
  if (mount?.podUid !== context.workerPodUid)
    throw new Error("Native proof belongs to another files executor");
}
