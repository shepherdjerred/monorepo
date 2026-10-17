import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { link, lstat, readFile, rename } from "node:fs/promises";
import nodePath from "node:path";
import { withAdvisoryLock } from "./advisory-lock.ts";
import {
  verifyStableFile,
  requireFileIdentity,
  type VerifiedFile,
  type VerifiedFileProof,
} from "./verification.ts";
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
  unlinkRegular,
  syncFile,
  syncDirectory,
  sha256File,
  copyExclusive,
  verifyControlExclusion,
  saveManifest,
  requireCapacity,
} from "./operations-io.ts";

/** Filesystem journal complements the database operation journal. All paths are root-relative. */
export class FileOperations {
  private readonly locks = new AsyncLocalStorage<readonly (() => void)[]>();
  constructor(
    private readonly roots: MediaFileRoots,
    private readonly options: {
      /** Rechecks committed intent/generation and operation ownership while the path lock is held. */
      authorize: (manifest: FileOperationManifest) => Promise<void>;
      verifyPlexExclusion?: (roots: MediaFileRoots) => Promise<void>;
      minimumFreeBytes?: number;
      /** Activity heartbeat/cancellation checkpoint. Throwing leaves a recoverable journal. */
      checkpoint?: (phase: string) => Promise<void>;
    },
  ) {
    validateMediaRoots(roots, options.verifyPlexExclusion !== undefined);
  }

  /** Return an in-process proof before taking PG locks; never acquire PG inside this callback. */
  async withVerifiedFile<T>(
    input: VerifiedFile,
    action: (proof: VerifiedFileProof) => Promise<T>,
  ): Promise<T> {
    const target = await safePath(this.roots.library, input.libraryPath, false);
    return await this.withLock(target, async () => {
      await this.verifyControlExclusion();
      await safePath(this.roots.library, input.libraryPath, false);
      const proof = await verifyStableFile(target, input, async () => {
        await this.checkpoint("hashing");
      });
      await safePath(this.roots.library, input.libraryPath, false);
      await this.verifyControlExclusion();
      for (const assertHeld of this.locks.getStore() ?? []) assertHeld();
      const result = await action(proof);
      for (const assertHeld of this.locks.getStore() ?? []) assertHeld();
      return result;
    });
  }

  /** Recheck a prior hash proof under PG → filesystem lock order without hashing again. */
  async withFileIdentity<T>(
    proof: VerifiedFileProof,
    action: () => Promise<T>,
  ): Promise<T> {
    const target = await safePath(this.roots.library, proof.libraryPath, false);
    return await this.withLock(target, async () => {
      await this.verifyControlExclusion();
      await safePath(this.roots.library, proof.libraryPath, false);
      await requireFileIdentity(target, proof);
      for (const assertHeld of this.locks.getStore() ?? []) assertHeld();
      const result = await action();
      for (const assertHeld of this.locks.getStore() ?? []) assertHeld();
      return result;
    });
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
    return await this.withLock(`operation:${input.operationId}`, async () => {
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
          if (await exists(partial)) await unlinkRegular(partial);
          await copyExclusive(source, partial, async () => {
            await this.checkpoint("copying");
          });
          await this.requireDigest(partial, input.sha256);
          await syncFile(partial);
          await rename(partial, staged);
          await syncDirectory(nodePath.dirname(staged));
        }
        await this.requireDigest(staged, input.sha256);
        manifest = { ...manifest, phase: "staged" };
        await this.save(manifest);
        await this.checkpoint("staged");
      }
      if (input.stopAfterStaging === true) return manifest;
      return await this.withLock(target, async () => {
        await this.authorize(manifest);
        if (await exists(target)) {
          const digest = await this.digest(target);
          if (digest === input.sha256) {
            if (await exists(staged)) await unlinkRegular(staged);
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
            await link(target, backup);
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
          await link(staged, target);
          await unlinkRegular(staged);
        } else {
          // The old file stays playable until this same-filesystem atomic replacement.
          await rename(staged, target);
        }
        await syncDirectory(nodePath.dirname(target));
        await this.checkpoint("published");
        return await this.complete(manifest);
      });
    });
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
    return await this.withLock(
      `operation:${input.rollbackOperationId}`,
      async () =>
        await this.withLock(target, async () => {
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
          const current = await this.digest(target);
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
            await link(target, rejected);
            await syncDirectory(nodePath.dirname(rejected));
          }
          const staged = await this.controlPath(
            `staging/${input.rollbackOperationId}`,
          );
          if (await exists(staged))
            await this.requireDigest(staged, input.previousSha256);
          else await link(source, staged);
          await this.authorize(manifest);
          await this.requireDigest(target, input.sha256);
          await this.authorize(manifest);
          await rename(staged, target);
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
  }): Promise<FileOperationManifest> {
    IdSchema.parse(input.operationId);
    IdSchema.parse(input.quarantineId);
    DigestSchema.parse(input.sha256);
    const source = await this.controlPath(`quarantine/${input.quarantineId}`);
    return await this.withLock(
      `operation:${input.operationId}`,
      async () =>
        await this.withLock(source, async () => {
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
            await unlinkRegular(source);
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
    return await this.withLock(
      `operation:${operationId}`,
      async () =>
        await this.withLock(
          first,
          async () =>
            await this.withLock(second, async () => {
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
                await link(source, target);
                await syncDirectory(nodePath.dirname(target));
              }
              await this.checkpoint("move-linked");
              if (await exists(source)) {
                await this.requireDigest(source, sha256);
                await this.authorize(manifest);
                await unlinkRegular(source);
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

  private async withLock<T>(
    target: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const name = createHash("sha256").update(target).digest("hex");
    const path = await this.controlPath(`locks/${name}.lock`);
    const outerLocks = this.locks.getStore() ?? [];
    return await withAdvisoryLock(
      path,
      async (assertHeld) =>
        await this.locks.run([...outerLocks, assertHeld], action),
    );
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

  private async digest(path: string): Promise<string> {
    return await sha256File(path, async () => {
      await this.checkpoint("hashing");
    });
  }
  private async requireDigest(path: string, digest: string): Promise<void> {
    if (!(await exists(path)) || (await this.digest(path)) !== digest)
      throw new FileOperationConflict(
        "Media content does not match its operation manifest",
      );
  }
  private async checkpoint(phase: string): Promise<void> {
    for (const assertHeld of this.locks.getStore() ?? []) assertHeld();
    await this.options.checkpoint?.(phase);
  }
}
