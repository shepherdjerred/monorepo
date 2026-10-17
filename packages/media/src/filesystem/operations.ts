import { lstat, readFile } from "node:fs/promises";
import { contentIO } from "./content-io.ts";
import type { ContentProof } from "./content-proof.ts";
import nodePath from "node:path";
import { OperationLocks, type ContentPath } from "./operation-locks.ts";
import { type VerifiedFile, type VerifiedFileProof } from "./verification.ts";
import {
  IdSchema,
  DigestSchema,
  ManifestSchema,
  FileOperationConflict,
  type FileOperationManifest,
  type MediaFileRoots,
  type ImportFile,
  type MoveFile,
} from "./operations-types.ts";
import {
  validateMediaRoots,
  safePath,
  exists,
  syncFile,
  syncDirectory,
  copyExclusive,
  verifyControlExclusion,
  saveManifest,
  requireCapacity,
} from "./operations-io.ts";

/** Filesystem journal complements the database operation journal. All paths are root-relative. */
export class FileOperations {
  private readonly locks: OperationLocks;
  private readonly content: ReturnType<typeof contentIO>;
  constructor(
    private readonly roots: MediaFileRoots,
    private readonly options: {
      /** Rechecks committed intent/generation and operation ownership while the path lock is held. */
      authorize: (manifest: FileOperationManifest) => Promise<void>;
      verifyPlexExclusion?: (roots: MediaFileRoots) => Promise<void>;
      minimumFreeBytes?: number;
      /** Activity heartbeat/cancellation checkpoint. Throwing leaves a recoverable journal. */
      checkpoint?: (phase: string) => Promise<void>;
      contentProof?: ContentProof;
    },
  ) {
    validateMediaRoots(roots, options.verifyPlexExclusion !== undefined);
    this.locks = new OperationLocks(
      roots,
      (relative) => this.controlPath(relative),
      () => this.verifyControlExclusion(),
    );
    this.content = contentIO(options.contentProof, async () => {
      await this.checkpoint("hashing");
    });
  }

  /** Return an in-process proof before taking PG locks; never acquire PG inside this callback. */
  async withVerifiedFile<T>(
    input: VerifiedFile,
    action: (proof: VerifiedFileProof) => Promise<T>,
  ): Promise<T> {
    return await this.locks.withVerifiedFile(input, action, () =>
      this.checkpoint("hashing"),
    );
  }

  /** Recheck a prior hash proof under PG → filesystem lock order without hashing again. */
  async withFileIdentity<T>(
    proof: VerifiedFileProof,
    action: () => Promise<T>,
  ): Promise<T> {
    return await this.locks.withFileIdentity(proof, action);
  }

  /** Sorted operation→library locks, with exact same-instance mutation composition. */
  async withFileIdentities<T>(
    proofs: readonly VerifiedFileProof[],
    action: () => Promise<T>,
    operationIds: readonly string[] = [],
  ): Promise<T> {
    return await this.locks.withFileIdentities(proofs, action, operationIds);
  }

  /** Exact present/absent library and control paths from this instance's fresh content proof. */
  async withContentPaths<T>(
    paths: readonly ContentPath[],
    action: () => Promise<T>,
    operationIds: readonly string[] = [],
  ): Promise<T> {
    if (this.options.contentProof === undefined)
      throw new FileOperationConflict(
        "Content path scope requires a process-local proof",
      );
    return await this.locks.withContentPaths(
      paths,
      this.options.contentProof,
      action,
      operationIds,
    );
  }

  async importFile(input: ImportFile): Promise<FileOperationManifest> {
    IdSchema.parse(input.operationId);
    DigestSchema.parse(input.sha256);
    if (input.previousSha256 !== undefined)
      DigestSchema.parse(input.previousSha256);
    const source = await safePath(
      this.roots.downloads,
      input.downloadPath,
      false,
    );
    const target = await safePath(this.roots.library, input.libraryPath, true);
    return await this.locks.withLock(
      `operation:${input.operationId}`,
      async () => {
        const descriptor = {
          version: 1,
          operationId: input.operationId,
          kind: "import",
          source,
          target,
          sha256: input.sha256,
          previousSha256: input.previousSha256 ?? null,
          phase: "prepared",
        };
        let manifest = await this.prepare(ManifestSchema.parse(descriptor));
        const staged = await this.controlPath(`staging/${input.operationId}`);
        const backup = await this.controlPath(`rollback/${input.operationId}`);
        if (manifest.phase === "complete") {
          await this.requireDigest(target, input.sha256);
          return manifest;
        }
        if (manifest.phase === "prepared") {
          if (this.options.contentProof !== undefined)
            throw new FileOperationConflict(
              "Publication requires previously staged content",
            );
          await this.requireDigest(source, input.sha256);
          const sourceStat = await lstat(source);
          await requireCapacity(
            staged,
            sourceStat.size,
            this.options.minimumFreeBytes,
          );
          if (!(await exists(staged))) {
            const partial = `${staged}.partial`;
            // Only this operation's journal-owned incomplete copy can be removed.
            if (await exists(partial)) await this.content.unlink(partial);
            await copyExclusive(source, partial, async () => {
              await this.checkpoint("copying");
            });
            await this.requireDigest(partial, input.sha256);
            await syncFile(partial);
            await this.content.rename(partial, staged);
            await syncDirectory(nodePath.dirname(staged));
          }
          await this.requireDigest(staged, input.sha256);
          manifest = { ...manifest, phase: "staged" };
          await this.save(manifest);
          await this.checkpoint("staged");
        }
        if (input.stopAfterStaging === true) return manifest;
        return await this.locks.withLock(target, async () => {
          await this.authorize(manifest);
          if (await exists(target)) {
            const digest = await this.content.digest(target);
            if (digest === input.sha256) {
              if (await exists(staged)) await this.content.unlink(staged);
              return await this.complete(manifest);
            }
            if (
              input.previousSha256 === undefined ||
              digest !== input.previousSha256
            )
              throw new FileOperationConflict(
                "Publication would replace an unrecognized file",
              );
            if (await exists(backup))
              await this.requireDigest(backup, input.previousSha256);
            else {
              await this.content.link(target, backup);
              await syncDirectory(nodePath.dirname(backup));
            }
            await this.checkpoint("previous-version-preserved");
            await this.requireDigest(target, input.previousSha256);
          } else if (input.previousSha256 !== undefined) {
            await this.requireDigest(backup, input.previousSha256);
          }
          await this.requireDigest(staged, input.sha256);
          await this.authorize(manifest);
          if (input.previousSha256 === undefined) {
            // New publications must never replace an unmanaged destination.
            await this.content.link(staged, target);
            await this.content.unlink(staged);
          } else {
            // The old file stays playable until this same-filesystem atomic replacement.
            await this.content.rename(staged, target);
          }
          await syncDirectory(nodePath.dirname(target));
          await this.checkpoint("published");
          return await this.complete(manifest);
        });
      },
    );
  }

  async quarantine(input: MoveFile): Promise<FileOperationManifest> {
    IdSchema.parse(input.quarantineId);
    const source = await safePath(this.roots.library, input.libraryPath, true);
    const target = await this.controlPath(`quarantine/${input.quarantineId}`);
    return await this.move({
      operationId: input.operationId,
      kind: "quarantine",
      source,
      target,
      sha256: input.sha256,
    });
  }

  /** Restore the exact previous version while retaining the failed publication for review. */
  async rollbackImport(input: {
    operationId: string;
    rollbackOperationId: string;
    libraryPath: string;
    sha256: string;
    previousSha256: string;
  }): Promise<FileOperationManifest> {
    IdSchema.parse(input.operationId);
    IdSchema.parse(input.rollbackOperationId);
    DigestSchema.parse(input.sha256);
    DigestSchema.parse(input.previousSha256);
    if (
      input.operationId === input.rollbackOperationId ||
      input.sha256 === input.previousSha256
    )
      throw new FileOperationConflict(
        "Rollback must identify a distinct version and operation",
      );
    const target = await safePath(this.roots.library, input.libraryPath, false);
    const source = await this.controlPath(`rollback/${input.operationId}`);
    const rejected = await this.controlPath(
      `rollback/${input.rollbackOperationId}`,
    );
    return await this.locks.withLock(
      `operation:${input.rollbackOperationId}`,
      async () =>
        await this.locks.withLock(target, async () => {
          const original = await this.readManifest(input.operationId);
          if (
            original?.kind !== "import" ||
            original.target !== target ||
            original.sha256 !== input.sha256 ||
            original.previousSha256 !== input.previousSha256
          )
            throw new FileOperationConflict(
              "Rollback does not match its import manifest",
            );
          const manifest = await this.prepare({
            version: 1,
            operationId: input.rollbackOperationId,
            kind: "rollback",
            source,
            target,
            sha256: input.previousSha256,
            previousSha256: input.sha256,
            phase: "prepared",
          });
          await this.requireDigest(source, input.previousSha256);
          await this.authorize(manifest);
          const current = await this.content.digest(target);
          if (current === input.previousSha256) {
            await this.requireDigest(rejected, input.sha256);
            return await this.complete(manifest);
          }
          if (current !== input.sha256 || manifest.phase === "complete")
            throw new FileOperationConflict(
              "Rollback publication changed ownership",
            );
          if (await exists(rejected))
            await this.requireDigest(rejected, input.sha256);
          else {
            await this.content.link(target, rejected);
            await syncDirectory(nodePath.dirname(rejected));
          }
          const staged = await this.controlPath(
            `staging/${input.rollbackOperationId}`,
          );
          if (await exists(staged))
            await this.requireDigest(staged, input.previousSha256);
          else await this.content.link(source, staged);
          await this.authorize(manifest);
          await this.requireDigest(target, input.sha256);
          await this.authorize(manifest);
          await this.content.rename(staged, target);
          await syncDirectory(nodePath.dirname(target));
          await this.checkpoint("rollback-published");
          return await this.complete(manifest);
        }),
    );
  }

  async restore(input: MoveFile): Promise<FileOperationManifest> {
    IdSchema.parse(input.quarantineId);
    const source = await this.controlPath(`quarantine/${input.quarantineId}`);
    const target = await safePath(this.roots.library, input.libraryPath, true);
    return await this.move({
      operationId: input.operationId,
      kind: "restore",
      source,
      target,
      sha256: input.sha256,
    });
  }

  /** Caller must commit a fresh retention/generation check before invoking this operation. */
  async purge(input: {
    operationId: string;
    quarantineId: string;
    sha256: string;
    location?: "quarantine" | "rollback";
  }): Promise<FileOperationManifest> {
    IdSchema.parse(input.operationId);
    IdSchema.parse(input.quarantineId);
    DigestSchema.parse(input.sha256);
    const source = await this.controlPath(
      `${input.location ?? "quarantine"}/${input.quarantineId}`,
    );
    return await this.locks.withLock(
      `operation:${input.operationId}`,
      async () =>
        await this.locks.withLock(source, async () => {
          // Absence is evidence too: never let either recovery branch bypass its
          // captured parent and leaf identities merely because exists() is false.
          await this.options.contentProof?.digest(source);
          const manifest = await this.prepare({
            version: 1,
            operationId: input.operationId,
            kind: "purge",
            source,
            target: source,
            sha256: input.sha256,
            previousSha256: null,
            phase: "prepared",
          });
          if (manifest.phase === "complete") {
            if (await exists(source))
              throw new FileOperationConflict("Purged path has been reused");
            return manifest;
          }
          if (await exists(source)) {
            await this.requireDigest(source, input.sha256);
            await this.authorize(manifest);
            await this.content.unlink(source);
            await syncDirectory(nodePath.dirname(source));
          }
          await this.checkpoint("purged");
          return await this.complete(manifest);
        }),
    );
  }

  async readManifest(
    operationId: string,
  ): Promise<FileOperationManifest | null> {
    IdSchema.parse(operationId);
    const path = await this.controlPath(`journal/${operationId}.json`);
    return (await exists(path))
      ? ManifestSchema.parse(JSON.parse(await readFile(path, "utf8")))
      : null;
  }

  private async move(input: {
    operationId: string;
    kind: "quarantine" | "restore";
    source: string;
    target: string;
    sha256: string;
  }): Promise<FileOperationManifest> {
    const { operationId, kind, source, target, sha256 } = input;
    IdSchema.parse(operationId);
    DigestSchema.parse(sha256);
    // Both names are locked in a stable order, so quarantine/purge/restore cannot overlap.
    const paths = [source, target].sort();
    const first = paths[0];
    const second = paths[1];
    if (first === undefined || second === undefined)
      throw new Error("Missing move paths");
    return await this.locks.withLock(
      `operation:${operationId}`,
      async () =>
        await this.locks.withLock(
          first,
          async () =>
            await this.locks.withLock(second, async () => {
              const manifest = await this.prepare({
                version: 1,
                operationId,
                kind,
                source,
                target,
                sha256,
                previousSha256: null,
                phase: "prepared",
              });
              if (manifest.phase === "complete") {
                await this.requireDigest(target, sha256);
                if (await exists(source))
                  throw new FileOperationConflict(
                    "Completed move source was recreated",
                  );
                return manifest;
              }
              await this.authorize(manifest);
              if (await exists(target)) {
                await this.requireDigest(target, sha256);
                if (await exists(source)) {
                  const left = await lstat(source);
                  const right = await lstat(target);
                  if (left.dev !== right.dev || left.ino !== right.ino)
                    throw new FileOperationConflict(
                      "Move destination already exists",
                    );
                }
              } else {
                await this.requireDigest(source, sha256);
                await this.authorize(manifest);
                await this.content.link(source, target);
                await syncDirectory(nodePath.dirname(target));
              }
              await this.checkpoint("move-linked");
              if (await exists(source)) {
                await this.requireDigest(source, sha256);
                await this.authorize(manifest);
                await this.content.unlink(source);
                await syncDirectory(nodePath.dirname(source));
              }
              await this.checkpoint("move-unlinked");
              return await this.complete(manifest);
            }),
        ),
    );
  }

  private async prepare(
    descriptor: FileOperationManifest,
  ): Promise<FileOperationManifest> {
    const existing = await this.readManifest(descriptor.operationId);
    if (existing !== null) {
      if (
        JSON.stringify({ ...existing, phase: "prepared" }) !==
        JSON.stringify(descriptor)
      )
        throw new FileOperationConflict(
          "Operation identifier was reused with different inputs",
        );
      return existing;
    }
    await this.save(descriptor);
    return descriptor;
  }

  private async complete(
    manifest: FileOperationManifest,
  ): Promise<FileOperationManifest> {
    const completed: FileOperationManifest = { ...manifest, phase: "complete" };
    await this.save(completed);
    return completed;
  }

  private async save(manifest: FileOperationManifest): Promise<void> {
    const path = await this.controlPath(`journal/${manifest.operationId}.json`);
    await saveManifest(path, manifest);
  }

  private async authorize(manifest: FileOperationManifest): Promise<void> {
    const locks = this.locks.getStore();
    if (locks === undefined || locks.length === 0)
      throw new Error("Missing filesystem operation lock");
    for (const assertHeld of locks) assertHeld();
    await this.verifyControlExclusion();
    await this.options.authorize(manifest);
    for (const assertHeld of locks) assertHeld();
  }

  private async controlPath(path: string): Promise<string> {
    await this.verifyControlExclusion();
    return await safePath(this.roots.control, path, true);
  }

  private async verifyControlExclusion(): Promise<void> {
    await verifyControlExclusion(this.roots, this.options.verifyPlexExclusion);
  }

  private async requireDigest(path: string, digest: string): Promise<void> {
    if (!(await exists(path)) || (await this.content.digest(path)) !== digest)
      throw new FileOperationConflict(
        "Media content does not match its operation manifest",
      );
  }
  private async checkpoint(phase: string): Promise<void> {
    for (const assertHeld of this.locks.getStore() ?? []) assertHeld();
    await this.options.checkpoint?.(phase);
  }
}
