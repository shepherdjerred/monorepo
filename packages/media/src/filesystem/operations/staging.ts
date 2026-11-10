import nodePath from "node:path";
import { lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { NativeFileIdentitySchema } from "#shared/native-subtitles.ts";
import { ContentProof } from "#filesystem/content-proof.ts";
import { contentIO } from "#filesystem/content-io.ts";
import type { OperationJournal } from "./journal.ts";
import type { OperationLocks } from "#filesystem/operation-locks.ts";
import {
  requireFileIdentity,
  type VerifiedFileProof,
} from "#filesystem/verification.ts";
import {
  copyExclusive,
  exists,
  requireCapacity,
  safePath,
  saveManifest,
  syncDirectory,
  syncFile,
} from "#filesystem/operations-io.ts";
import {
  DigestSchema,
  IdSchema,
  ManifestSchema,
  FileOperationConflict,
  type ImportFile,
  type FileOperationManifest,
  type MediaFileRoots,
} from "#filesystem/operations-types.ts";

/** Only the originating FileOperations instance can consume this handle. JSON cannot reconstruct it. */
export type PreparedImport = Readonly<{ operationId: string }>;
/** Only the prepared-copy reader consumes this ACK; ordinary manifests stay literal v1. */
const PreparedImportJournalSchema = ManifestSchema.extend({
  preparedPartial: z
    .strictObject({
      schemaVersion: z.literal(1),
      sizeBytes: z.string().regex(/^\d+$/u),
      identity: NativeFileIdentitySchema,
    })
    .optional(),
});
type PreparedImportJournal = z.infer<typeof PreparedImportJournalSchema>;
type Prepared = {
  manifest: PreparedImportJournal;
  journalPath: string;
  journalProof: VerifiedFileProof;
  journalContent: ContentProof;
  content: ContentProof;
  partial: string;
  staged: string;
};
type CopyIO = {
  requireDigest: (path: string, checksum: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
};

async function capturePreparedJournal(
  path: string,
  manifest: PreparedImportJournal,
  checkpoint: () => Promise<void>,
) {
  const content = new ContentProof();
  await content.capture(path, checkpoint);
  content.seal();
  const proof = await content.verifiedFile(path);
  const raw = await readFile(path, "utf8");
  if (
    createHash("sha256").update(raw).digest("hex") !== proof.sha256 ||
    raw !== JSON.stringify(manifest)
  )
    throw new FileOperationConflict("Prepared import journal changed");
  await content.digest(path);
  return { content, proof };
}

/** Shared original copy/hash/fsync preparation, always outside database authority locks. */
export async function copyImportPartial(input: {
  source: string;
  partial: string;
  checksum: string;
  content: CopyIO;
  replaceExisting: boolean;
  checkpoint: () => Promise<void>;
}) {
  if (await exists(input.partial)) {
    if (!input.replaceExisting)
      throw new FileOperationConflict(
        "Unproven import partial requires recovery",
      );
    await input.content.unlink(input.partial);
  }
  await copyExclusive(input.source, input.partial, input.checkpoint);
  await input.content.requireDigest(input.partial, input.checksum);
  await syncFile(input.partial);
}

export class ImportStaging {
  private readonly prepared = new WeakMap<PreparedImport, Prepared>();
  constructor(
    private readonly context: {
      roots: MediaFileRoots;
      locks: OperationLocks;
      journal: OperationJournal;
      controlPath: (relative: string) => Promise<string>;
      content: CopyIO;
      checkpoint: (phase: string) => Promise<void>;
      minimumFreeBytes: number | undefined;
      beforeEffect: () => void;
    },
  ) {}

  async prepare(input: ImportFile): Promise<PreparedImport> {
    IdSchema.parse(input.operationId);
    DigestSchema.parse(input.sha256);
    if (input.previousSha256 !== undefined)
      DigestSchema.parse(input.previousSha256);
    const { roots, locks, journal } = this.context;
    const descriptor = ManifestSchema.parse({
      version: 1,
      operationId: input.operationId,
      kind: "import",
      source: await safePath(roots.downloads, input.downloadPath, false),
      target: await safePath(roots.library, input.libraryPath, true),
      sha256: input.sha256,
      previousSha256: input.previousSha256 ?? null,
      phase: "prepared",
    });
    return locks.withLock(`operation:${input.operationId}`, async () => {
      this.context.beforeEffect();
      const original = await journal.prepare(descriptor);
      if (original.phase === "complete")
        throw new FileOperationConflict(
          "Completed imports require committed readback",
        );
      const journalPath = await this.context.controlPath(
        `journal/${input.operationId}.json`,
      );
      let manifest = PreparedImportJournalSchema.parse(
        JSON.parse(await readFile(journalPath, "utf8")),
      );
      if (
        JSON.stringify(ManifestSchema.parse(manifest)) !==
        JSON.stringify(original)
      )
        throw new FileOperationConflict("Prepared import journal changed");
      // Retain the actual original journal before any long copy/hash awaits.
      const originalJournal = await capturePreparedJournal(
        journalPath,
        manifest,
        () => this.context.checkpoint("hashing"),
      );
      const staged = await this.context.controlPath(
        `staging/${input.operationId}`,
      );
      const partial = `${staged}.partial`;
      if (manifest.phase === "prepared") {
        if (await exists(staged))
          throw new FileOperationConflict(
            "Unacknowledged staged artifact requires recovery",
          );
        await this.context.content.requireDigest(
          descriptor.source,
          input.sha256,
        );
        if (manifest.preparedPartial === undefined) {
          const source = await lstat(descriptor.source);
          await requireCapacity(
            partial,
            source.size,
            this.context.minimumFreeBytes,
          );
          await copyImportPartial({
            source: descriptor.source,
            partial,
            checksum: input.sha256,
            replaceExisting: false,
            content: this.context.content,
            checkpoint: () => this.context.checkpoint("copying"),
          });
        }
      }
      const content = new ContentProof();
      for (const path of [partial, staged])
        await content.capture(path, () => this.context.checkpoint("hashing"));
      content.seal();
      if (
        (await content.digest(
          manifest.phase === "staged" ? staged : partial,
        )) !== input.sha256
      )
        throw new FileOperationConflict("Prepared import content changed");
      await originalJournal.content.digest(journalPath);
      if (manifest.phase === "prepared") {
        const identity = await content.reviewIdentity(partial);
        const verified = await content.verifiedFile(partial);
        const acknowledged = manifest.preparedPartial;
        if (acknowledged === undefined) {
          // Only this invocation's actual completed copy may create its receipt.
          // Cold callers must never adopt a pre-existing unacknowledged partial.
          this.context.beforeEffect();
          manifest = {
            ...manifest,
            preparedPartial: {
              schemaVersion: 1,
              sizeBytes: verified.sizeBytes,
              identity,
            },
          };
          await journal.save(manifest, {
            validateBeforeInstall: async () => {
              await originalJournal.content.digest(journalPath);
            },
          });
        } else if (
          acknowledged.sizeBytes !== verified.sizeBytes ||
          JSON.stringify(acknowledged.identity) !== JSON.stringify(identity)
        )
          throw new FileOperationConflict(
            "Prepared import partial identity changed",
          );
      }
      const acknowledgedJournal = await capturePreparedJournal(
        journalPath,
        manifest,
        () => this.context.checkpoint("hashing"),
      );
      const handle = Object.freeze({ operationId: input.operationId });
      this.prepared.set(handle, {
        manifest,
        journalPath,
        journalProof: acknowledgedJournal.proof,
        journalContent: acknowledgedJournal.content,
        content,
        partial,
        staged,
      });
      return handle;
    });
  }

  async commit(
    handle: PreparedImport,
    authority: {
      authorize: () => Promise<void>;
      beforeEffect: () => void;
    },
  ): Promise<FileOperationManifest> {
    const prepared = this.prepared.get(handle);
    if (prepared === undefined)
      throw new FileOperationConflict(
        "Foreign or consumed prepared import capability",
      );
    const {
      manifest,
      content,
      partial,
      staged,
      journalPath,
      journalProof,
      journalContent,
    } = prepared;
    const beforeEffect = () => {
      this.context.beforeEffect();
      authority.beforeEffect();
      content.assertActive();
      journalContent.assertActive();
      for (const held of this.context.locks.getStore() ?? []) held();
    };
    return this.context.locks.withContentPaths(
      [
        { root: "control", path: `staging/${manifest.operationId}.partial` },
        { root: "control", path: `staging/${manifest.operationId}` },
      ],
      content,
      async () => {
        await requireFileIdentity(journalPath, journalProof);
        await journalContent.digest(journalPath);
        await authority.authorize();
        beforeEffect();
        if (manifest.phase === "staged") return manifest;
        const io = contentIO(
          content,
          () => this.context.checkpoint("hashing"),
          beforeEffect,
        );
        await io.rename(partial, staged);
        await syncDirectory(nodePath.dirname(staged));
        await requireFileIdentity(journalPath, journalProof);
        await journalContent.digest(journalPath);
        const result = { ...manifest, phase: "staged" as const };
        // The acknowledgment names the old partial inode/ctime. Once accepted,
        // ordinary staged/publication journals retain their original literal shape.
        delete result.preparedPartial;
        await saveManifest(journalPath, result, {
          beforeInstall: beforeEffect,
        });
        this.prepared.delete(handle);
        await this.context.checkpoint("staged");
        return result;
      },
      [manifest.operationId],
    );
  }
}
