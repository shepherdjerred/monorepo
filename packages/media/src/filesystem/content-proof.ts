import { link, lstat, rename } from "node:fs/promises";
import nodePath from "node:path";
import { exists, unlinkRegular } from "./operations-io.ts";
import { FileOperationConflict } from "./operations-types.ts";
import {
  hashStableFile,
  requireFileIdentity,
  type VerifiedFileProof,
} from "./verification.ts";

/** Process-local evidence, including absence. Never serialize this capability into a journal. */
export class ContentProof {
  private readonly files = new Map<string, VerifiedFileProof | null>();
  private readonly parents = new Map<string, { dev: bigint; ino: bigint }>();
  private sealedAt: number | null = null;

  async capture(path: string, checkpoint: () => Promise<void>): Promise<void> {
    if (this.sealedAt !== null)
      throw new FileOperationConflict("Content proof is already sealed");
    if (this.files.has(path)) return;
    for (const parent of ancestors(path)) {
      const info = await lstat(parent, { bigint: true });
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new FileOperationConflict(
          "Media ancestor is not a real directory",
        );
      if (!this.parents.has(parent))
        this.parents.set(parent, { dev: info.dev, ino: info.ino });
    }
    await this.assertParents(path);
    this.files.set(
      path,
      (await exists(path)) ? await hashStableFile(path, checkpoint) : null,
    );
    await this.assertParents(path);
  }

  seal(): void {
    if (this.sealedAt !== null)
      throw new FileOperationConflict("Content proof cannot be renewed");
    this.sealedAt = performance.now();
  }

  async digest(path: string): Promise<string | null> {
    const proof = await this.assert(path);
    return proof?.sha256 ?? null;
  }

  /** Process-local identity capability for final PG → path-lock authority checks. */
  async verifiedFile(path: string): Promise<VerifiedFileProof> {
    return await this.require(path);
  }

  /** Audit identity for owner review only. It cannot reconstruct or authorize a content proof. */
  async reviewIdentity(path: string) {
    const proof = await this.require(path);
    return {
      device: proof.dev.toString(),
      inode: proof.ino.toString(),
      mtimeNs: proof.mtimeNs.toString(),
      ctimeNs: proof.ctimeNs.toString(),
      ancestors: this.reviewAncestors(path),
    };
  }

  /** Audit only: an absent path is bound to its captured real ancestor identities. */
  async reviewAbsence(path: string) {
    if ((await this.assert(path)) !== null)
      throw new FileOperationConflict("Reviewed absent media path exists");
    return { ancestors: this.reviewAncestors(path) };
  }

  private reviewAncestors(path: string) {
    return ancestors(path).map((parent) => {
      const identity = this.parents.get(parent);
      if (identity === undefined)
        throw new FileOperationConflict(
          "Media ancestor has no captured identity",
        );
      return {
        path: parent,
        device: identity.dev.toString(),
        inode: identity.ino.toString(),
      };
    });
  }

  async link(source: string, target: string): Promise<void> {
    const proof = await this.require(source);
    if ((await this.assert(target)) !== null)
      throw new FileOperationConflict(
        "Verified link destination already exists",
      );
    await link(source, target);
    await this.recordMutation(source, proof);
    const current = await this.require(source);
    this.files.set(target, Object.freeze({ ...current, target }));
    await this.assert(target);
  }

  async rename(source: string, target: string): Promise<void> {
    const proof = await this.require(source);
    const previous = await this.assert(target);
    await rename(source, target);
    this.files.set(source, null);
    this.files.set(target, Object.freeze({ ...proof, target }));
    await this.recordMutation(target, proof);
    if (previous !== null) await this.refreshRemainingAlias(previous);
  }

  async unlink(path: string): Promise<void> {
    const proof = await this.require(path);
    await unlinkRegular(path);
    this.files.set(path, null);
    await this.refreshRemainingAlias(proof);
  }

  private async refreshRemainingAlias(proof: VerifiedFileProof): Promise<void> {
    const alias = [...this.files.entries()].find(
      ([, item]) =>
        item !== null && item.dev === proof.dev && item.ino === proof.ino,
    );
    if (alias !== undefined) await this.recordMutation(alias[0], proof);
  }

  private async assert(path: string): Promise<VerifiedFileProof | null> {
    if (this.sealedAt === null || performance.now() - this.sealedAt > 60_000)
      throw new FileOperationConflict("Content proof is unsealed or expired");
    await this.assertParents(path);
    const proof = this.files.get(path);
    if (proof === undefined)
      throw new FileOperationConflict(
        "Filesystem path has no preverified content proof",
      );
    if (proof === null) {
      if (await exists(path))
        throw new FileOperationConflict(
          "Previously absent media path was created",
        );
    } else await requireFileIdentity(path, proof);
    return proof;
  }

  private async require(path: string): Promise<VerifiedFileProof> {
    const proof = await this.assert(path);
    if (proof === null)
      throw new FileOperationConflict("Verified media file is missing");
    return proof;
  }

  /** Only our known link/unlink/rename may change ctime; content identity must remain exact. */
  private async recordMutation(
    path: string,
    proof: VerifiedFileProof,
  ): Promise<void> {
    await this.assertParents(path);
    const info = await lstat(path, { bigint: true });
    if (
      !info.isFile() ||
      info.dev !== proof.dev ||
      info.ino !== proof.ino ||
      info.size !== BigInt(proof.sizeBytes) ||
      info.mtimeNs !== proof.mtimeNs
    )
      throw new FileOperationConflict(
        "Media content changed during journaled filesystem mutation",
      );
    for (const [name, item] of this.files) {
      if (item !== null && item.dev === proof.dev && item.ino === proof.ino)
        this.files.set(name, Object.freeze({ ...item, ctimeNs: info.ctimeNs }));
    }
  }

  private async assertParents(path: string): Promise<void> {
    for (const parent of ancestors(path)) {
      const proof = this.parents.get(parent);
      const info = await lstat(parent, { bigint: true });
      if (
        proof === undefined ||
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        info.dev !== proof.dev ||
        info.ino !== proof.ino
      )
        throw new FileOperationConflict(
          "Media ancestor changed after verification",
        );
    }
  }
}

function ancestors(path: string): string[] {
  const result: string[] = [];
  for (
    let current = nodePath.dirname(path);
    ;
    current = nodePath.dirname(current)
  ) {
    result.push(current);
    if (current === nodePath.dirname(current)) return result;
  }
}
