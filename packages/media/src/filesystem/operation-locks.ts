import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  FileLockError,
  withAdvisoryLock,
  withAdvisoryLocks,
} from "./advisory-lock.ts";
import {
  FileOperationConflict,
  IdSchema,
  type MediaFileRoots,
} from "./operations-types.ts";
import { safePath } from "./operations-io.ts";
import {
  requireFileIdentity,
  verifyStableFile,
  type VerifiedFile,
  type VerifiedFileProof,
} from "./verification.ts";
import type { ContentProof } from "./content-proof.ts";

export type ContentPath = { root: "library" | "control"; path: string };

/** Same-instance explicit scopes; sibling mutations share the busy-key guard. */
export class OperationLocks {
  private readonly locks = new AsyncLocalStorage<readonly (() => void)[]>();
  private readonly heldTargets = new AsyncLocalStorage<ReadonlySet<string>>();
  private readonly proofScope = new AsyncLocalStorage<{
    allowed: ReadonlySet<string>;
    busy: Set<string>;
  }>();
  constructor(
    private readonly roots: MediaFileRoots,
    private readonly controlPath: (relative: string) => Promise<string>,
    private readonly verifyControlExclusion: () => Promise<void>,
  ) {}
  getStore() {
    return this.locks.getStore();
  }
  isHeld(target: string): boolean {
    return this.heldTargets.getStore()?.has(target) === true;
  }
  async withFileIdentity<T>(
    proof: VerifiedFileProof,
    action: () => Promise<T>,
  ): Promise<T> {
    if (this.isHeld(proof.target)) throw new FileLockError("busy");
    const target = await safePath(this.roots.library, proof.libraryPath, false);
    return await this.withLock(target, async () => {
      await this.verifyControlExclusion();
      await requireFileIdentity(target, proof);
      for (const assertHeld of this.getStore() ?? []) assertHeld();
      const result = await action();
      for (const assertHeld of this.getStore() ?? []) assertHeld();
      return result;
    });
  }
  async withVerifiedFile<T>(
    input: VerifiedFile,
    action: (proof: VerifiedFileProof) => Promise<T>,
    checkpoint: () => Promise<void>,
  ): Promise<T> {
    const target = await safePath(this.roots.library, input.libraryPath, false);
    return await this.withLock(target, async () => {
      await this.verifyControlExclusion();
      await safePath(this.roots.library, input.libraryPath, false);
      const proof = await verifyStableFile(target, input, checkpoint);
      await safePath(this.roots.library, input.libraryPath, false);
      await this.verifyControlExclusion();
      for (const assertHeld of this.getStore() ?? []) assertHeld();
      const result = await action(proof);
      for (const assertHeld of this.getStore() ?? []) assertHeld();
      return result;
    });
  }
  /** Sorted library locks retained through a short final DB/effect callback. */
  async withFileIdentities<T>(
    proofs: readonly VerifiedFileProof[],
    action: () => Promise<T>,
    operationIds: readonly string[] = [],
  ): Promise<T> {
    const paths = proofs.map((proof) => proof.target);
    return await this.withScope(
      paths,
      async (target) => {
        const proof = proofs.find((item) => item.target === target);
        if (proof === undefined) throw new Error("Scoped identity missing");
        const safe = await safePath(
          this.roots.library,
          proof.libraryPath,
          false,
        );
        if (safe !== target)
          throw new FileOperationConflict("Scoped identity path changed");
        await requireFileIdentity(target, proof);
      },
      action,
      operationIds,
    );
  }

  async withContentPaths<T>(
    paths: readonly ContentPath[],
    content: ContentProof,
    action: () => Promise<T>,
    operationIds: readonly string[],
  ): Promise<T> {
    const entries: (ContentPath & { target: string })[] = [];
    for (const entry of paths) {
      if (!["library", "control"].includes(entry.root))
        throw new FileOperationConflict("Unsupported content proof root");
      entries.push({
        ...entry,
        target: await safePath(this.roots[entry.root], entry.path, false),
      });
    }
    return await this.withScope(
      entries.map((entry) => entry.target),
      async (target) => {
        const entry = entries.find((item) => item.target === target);
        if (entry === undefined) throw new Error("Scoped content path missing");
        if (
          (await safePath(this.roots[entry.root], entry.path, false)) !== target
        )
          throw new FileOperationConflict("Scoped content path changed");
        await content.digest(target);
      },
      async () => {
        const result = await action();
        for (const entry of entries) await content.digest(entry.target);
        return result;
      },
      operationIds,
    );
  }

  private async withScope<T>(
    paths: readonly string[],
    validate: (path: string) => Promise<void>,
    action: () => Promise<T>,
    operationIds: readonly string[],
  ): Promise<T> {
    if (
      this.proofScope.getStore() !== undefined ||
      paths.length === 0 ||
      new Set(paths).size !== paths.length
    )
      throw new FileOperationConflict(
        "Nested, empty or duplicate filesystem proof scope",
      );
    const sorted = [...paths].sort();
    const operationKeys = [
      ...new Set(operationIds.map((id) => `operation:${IdSchema.parse(id)}`)),
    ].sort();
    const targets = [...operationKeys, ...sorted];
    const held = this.heldTargets.getStore() ?? new Set<string>();
    if (targets.some((target) => held.has(target)))
      throw new FileLockError("busy");
    const lockPaths = [];
    for (const target of targets) {
      const name = createHash("sha256").update(target).digest("hex");
      lockPaths.push(await this.controlPath(`locks/${name}.lock`));
    }
    const outerLocks = this.locks.getStore() ?? [];
    return await withAdvisoryLocks(lockPaths, (assertHeld) =>
      this.heldTargets.run(new Set([...held, ...targets]), () =>
        this.locks.run([...outerLocks, assertHeld], async () => {
          for (const target of sorted) {
            await this.verifyControlExclusion();
            await validate(target);
          }
          for (const check of this.locks.getStore() ?? []) check();
          const result = await this.proofScope.run(
            { allowed: new Set(targets), busy: new Set() },
            action,
          );
          for (const check of this.locks.getStore() ?? []) check();
          return result;
        }),
      ),
    );
  }

  async withLock<T>(target: string, action: () => Promise<T>): Promise<T> {
    const held = this.heldTargets.getStore() ?? new Set<string>();
    const scope = this.proofScope.getStore();
    if (scope !== undefined && !scope.allowed.has(target))
      throw new FileOperationConflict(
        "Mutation requested an unscoped filesystem lock",
      );
    if (held.has(target)) {
      if (scope === undefined) throw new FileLockError("busy");
      if (scope.busy.has(target))
        throw new FileOperationConflict(
          "Concurrent nested filesystem mutation",
        );
      scope.busy.add(target);
      try {
        for (const assertHeld of this.locks.getStore() ?? []) assertHeld();
        const result = await action();
        for (const assertHeld of this.locks.getStore() ?? []) assertHeld();
        return result;
      } finally {
        scope.busy.delete(target);
      }
    }
    const name = createHash("sha256").update(target).digest("hex");
    const path = await this.controlPath(`locks/${name}.lock`);
    const outerLocks = this.locks.getStore() ?? [];
    return await withAdvisoryLock(
      path,
      async (assertHeld) =>
        await this.heldTargets.run(new Set([...held, target]), () =>
          this.locks.run([...outerLocks, assertHeld], action),
        ),
    );
  }
}
