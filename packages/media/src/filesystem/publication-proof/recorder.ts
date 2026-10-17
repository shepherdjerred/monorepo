import path from "node:path";
import {
  LockedPrimitiveEffectSchema,
  LockedJournalCompletionSchema,
  PhysicalPathStateSchema,
  type LockedPrimitiveEffect,
  type LockedPublicationEvent,
  type PublicationJournal,
} from "#shared/publication-proof/effects.ts";
import type { JournalCompletionRecorder } from "#filesystem/operations/journal.ts";
import type { ContentProof } from "#filesystem/content-proof.ts";
import type { OperationLocks } from "#filesystem/operation-locks.ts";
import {
  FileOperationConflict,
  type FileOperationManifest,
  type MediaFileRoots,
} from "#filesystem/operations-types.ts";
import { exists, syncDirectory, syncFile } from "#filesystem/operations-io.ts";
import { contentIO } from "#filesystem/content-io.ts";
import { publicationPath } from "./paths.ts";
import { durablePublicationJournal } from "./journal.ts";

export type PrimitiveRecorder = {
  assertActive: () => void;
  acknowledge: (effect: LockedPublicationEvent) => Promise<void>;
};
export type PrimitiveDescriptor = {
  manifest: FileOperationManifest;
  step: LockedPrimitiveEffect["step"];
};
type Context = {
  roots: MediaFileRoots;
  locks: OperationLocks;
  proof: ContentProof | undefined;
  recorder: PrimitiveRecorder | undefined;
  beforeEffect: (() => void) | undefined;
  verify: () => Promise<void>;
  journals: Map<string, PublicationJournal>;
};

async function snapshot(context: Context, paths: readonly string[]) {
  const proof = context.proof;
  if (proof === undefined)
    throw new FileOperationConflict("Recorded mutation requires content proof");
  return await Promise.all(
    paths.map(async (filename) => {
      const relative = await publicationPath(context.roots, filename);
      const sha256 = await proof.digest(filename);
      if (sha256 === null)
        return PhysicalPathStateSchema.parse({
          ...relative,
          state: "absent",
          ...(await proof.reviewAbsence(filename)),
        });
      const verified = await proof.verifiedFile(filename);
      return PhysicalPathStateSchema.parse({
        ...relative,
        state: "present",
        sha256,
        sizeBytes: verified.sizeBytes,
        identity: await proof.reviewIdentity(filename),
      });
    }),
  );
}

function assertLocks(
  context: Context,
  paths: readonly string[],
  operationId: string,
) {
  context.recorder?.assertActive();
  if (
    ![...paths, `operation:${operationId}`].every((key) =>
      context.locks.isHeld(key),
    )
  )
    throw new FileOperationConflict(
      "Recorded mutation requires every affected path lock",
    );
  for (const held of context.locks.getStore() ?? []) held();
}

async function mutate(
  context: Context,
  input: {
    primitive: LockedPrimitiveEffect["primitive"];
    source: string;
    target: string | null;
    descriptor: PrimitiveDescriptor | undefined;
  },
  action: () => Promise<void>,
) {
  const recorder = context.recorder;
  if (recorder === undefined) {
    await action();
    return;
  }
  recorder.assertActive();
  const { descriptor, source, target, primitive } = input;
  if (descriptor === undefined || context.proof === undefined)
    throw new FileOperationConflict(
      "Recorded mutation has no exact descriptor/proof",
    );
  const paths = await context.proof.mutationPaths(
    target === null ? [source] : [source, target],
  );
  const operationId = descriptor.manifest.operationId;
  assertLocks(context, paths, operationId);
  const sourcePath = await publicationPath(context.roots, source);
  const targetPath =
    target === null ? null : await publicationPath(context.roots, target);
  await context.verify();
  const before = await snapshot(context, paths);
  const journal = await durablePublicationJournal(
    context.roots,
    descriptor.manifest,
  );
  const priorJournal = context.journals.get(operationId);
  if (
    priorJournal !== undefined &&
    JSON.stringify(priorJournal) !== JSON.stringify(journal)
  )
    throw new FileOperationConflict(
      "Recorded publication journal was replaced",
    );
  assertLocks(context, paths, operationId);
  await action();
  // Durability precedes after-effect acknowledgment; every surviving alias remains proven.
  for (const filename of paths) {
    assertLocks(context, paths, operationId);
    if ((await context.proof.digest(filename)) !== null)
      await syncFile(filename);
  }
  for (const directory of new Set(
    paths.map((filename) => path.dirname(filename)),
  ))
    await syncDirectory(directory);
  const after = await snapshot(context, paths);
  const currentJournal = await durablePublicationJournal(
    context.roots,
    descriptor.manifest,
  );
  if (JSON.stringify(journal) !== JSON.stringify(currentJournal))
    throw new FileOperationConflict(
      "Publication journal changed across mutation",
    );
  assertLocks(context, paths, operationId);
  await recorder.acknowledge(
    LockedPrimitiveEffectSchema.parse({
      operationId,
      step: descriptor.step,
      primitive,
      source: sourcePath,
      target: targetPath,
      before,
      after,
      journal,
    }),
  );
  context.journals.set(operationId, journal);
  assertLocks(context, paths, operationId);
  await snapshot(context, paths);
}

function journalPaths(context: Context, manifest: FileOperationManifest) {
  if (manifest.kind === "import")
    return [
      manifest.target,
      ...["staging", "rollback"].map((directory) =>
        path.join(context.roots.control, directory, manifest.operationId),
      ),
    ];
  if (manifest.kind === "rollback")
    return [
      manifest.source,
      manifest.target,
      ...["staging", "rollback"].map((directory) =>
        path.join(context.roots.control, directory, manifest.operationId),
      ),
    ];
  if (manifest.kind === "quarantine" || manifest.kind === "restore")
    return [manifest.source, manifest.target];
  throw new FileOperationConflict(
    "Recorded publication cannot complete a purge journal",
  );
}

function completionRecorder(context: Context): JournalCompletionRecorder {
  return async (manifest, save) => {
    const recorder = context.recorder;
    if (recorder === undefined) {
      await save();
      return;
    }
    if (context.proof === undefined || manifest.phase === "complete")
      throw new FileOperationConflict(
        "Recorded journal completion requires a fresh unfinished operation",
      );
    const paths = await context.proof.mutationPaths(
      journalPaths(context, manifest),
    );
    assertLocks(context, paths, manifest.operationId);
    await context.verify();
    const beforeJournal = await durablePublicationJournal(
      context.roots,
      manifest,
    );
    const priorJournal = context.journals.get(manifest.operationId);
    if (
      priorJournal !== undefined &&
      JSON.stringify(priorJournal) !== JSON.stringify(beforeJournal)
    )
      throw new FileOperationConflict(
        "Recorded publication journal was replaced",
      );
    const participants = await snapshot(context, paths);
    assertLocks(context, paths, manifest.operationId);
    await save({
      beforeInstall: () => {
        assertLocks(context, paths, manifest.operationId);
      },
      acknowledge: async (installed) => {
        assertLocks(context, paths, manifest.operationId);
        const journal = await durablePublicationJournal(context.roots, {
          ...manifest,
          phase: "complete",
        });
        if (
          journal.identity.device !== installed.device ||
          journal.identity.inode !== installed.inode ||
          journal.sizeBytes !== installed.sizeBytes ||
          journal.identity.mtimeNs !== installed.mtimeNs ||
          JSON.stringify(journal.identity.ancestors) !==
            JSON.stringify(beforeJournal.identity.ancestors)
        )
          throw new FileOperationConflict(
            "Completed journal is not the actual installed file",
          );
        if (
          JSON.stringify(await snapshot(context, paths)) !==
          JSON.stringify(participants)
        )
          throw new FileOperationConflict(
            "Media changed during journal completion",
          );
        assertLocks(context, paths, manifest.operationId);
        await recorder.acknowledge(
          LockedJournalCompletionSchema.parse({
            operationId: manifest.operationId,
            step: "journal_complete",
            primitive: "journal_complete",
            beforeJournal,
            journal,
            participants,
          }),
        );
        context.journals.set(manifest.operationId, journal);
        assertLocks(context, paths, manifest.operationId);
        if (
          JSON.stringify(
            await durablePublicationJournal(context.roots, {
              ...manifest,
              phase: "complete",
            }),
          ) !== JSON.stringify(journal)
        )
          throw new FileOperationConflict(
            "Completed journal changed after acknowledgment",
          );
        await snapshot(context, paths);
      },
    });
  };
}

/** No-hook calls delegate directly, retaining historical behavior and serialization. */
export function recordedContentIO(
  input: Omit<Context, "journals">,
  checkpoint: () => Promise<void>,
) {
  const context: Context = { ...input, journals: new Map() };
  const assertActive = () => {
    context.beforeEffect?.();
    context.recorder?.assertActive();
    context.proof?.assertActive();
    for (const held of context.locks.getStore() ?? []) held();
  };
  const base = contentIO(
    context.proof,
    checkpoint,
    context.recorder === undefined && context.beforeEffect === undefined
      ? undefined
      : assertActive,
  );
  return {
    assertActive,
    completeJournal: completionRecorder(context),
    digest: (filename: string) => base.digest(filename),
    async requireDigest(filename: string, digest: string): Promise<void> {
      if (!(await exists(filename)) || (await base.digest(filename)) !== digest)
        throw new FileOperationConflict(
          "Media content does not match its operation manifest",
        );
    },
    link: (source: string, target: string, descriptor?: PrimitiveDescriptor) =>
      mutate(context, { primitive: "link", source, target, descriptor }, () =>
        base.link(source, target),
      ),
    rename: (
      source: string,
      target: string,
      descriptor?: PrimitiveDescriptor,
    ) =>
      mutate(context, { primitive: "rename", source, target, descriptor }, () =>
        base.rename(source, target),
      ),
    unlink: (source: string, descriptor?: PrimitiveDescriptor) =>
      mutate(
        context,
        { primitive: "unlink", source, target: null, descriptor },
        () => base.unlink(source),
      ),
  };
}
