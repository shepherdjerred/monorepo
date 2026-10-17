import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { FileLockError, withAdvisoryLock } from "./advisory-lock.ts";
import {
  FileOperationConflict,
  IdSchema,
  type MediaFileRoots,
} from "./operations-types.ts";
import { safePath } from "./operations-io.ts";
import { requireFileIdentity, type VerifiedFileProof } from "./verification.ts";

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
  /** Sorted library locks retained through a short final DB/effect callback. */
  async withFileIdentities<T>(
    proofs: readonly VerifiedFileProof[],
    action: () => Promise<T>,
    operationIds: readonly string[] = [],
  ): Promise<T> {
    if (
      this.proofScope.getStore() !== undefined ||
      proofs.length === 0 ||
      new Set(proofs.map((item) => item.target)).size !== proofs.length
    )
      throw new FileOperationConflict(
        "Nested, empty or duplicate filesystem proof scope",
      );
    const sorted = [...proofs].sort((a, b) => a.target.localeCompare(b.target));
    const operationKeys = [
      ...new Set(operationIds.map((id) => `operation:${IdSchema.parse(id)}`)),
    ].sort();
    const operations = async (index: number): Promise<T> => {
      const key = operationKeys[index];
      return key === undefined
        ? await enter(0)
        : await this.withLock(key, () => operations(index + 1));
    };
    const enter = async (index: number): Promise<T> => {
      const proof = sorted[index];
      if (proof === undefined) {
        for (const assertHeld of this.locks.getStore() ?? []) assertHeld();
        const result = await this.proofScope.run(
          {
            allowed: new Set([
              ...operationKeys,
              ...sorted.map((item) => item.target),
            ]),
            busy: new Set(),
          },
          action,
        );
        for (const assertHeld of this.locks.getStore() ?? []) assertHeld();
        return result;
      }
      const target = await safePath(
        this.roots.library,
        proof.libraryPath,
        false,
      );
      return await this.withLock(target, async () => {
        await this.verifyControlExclusion();
        await requireFileIdentity(target, proof);
        return await enter(index + 1);
      });
    };
    return await operations(0);
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
