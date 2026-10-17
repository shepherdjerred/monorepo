import { lstat, realpath, statfs } from "node:fs/promises";
import { z } from "zod";
import {
  CAPACITY_MAX_BYTES,
  type CapacityRole,
  type CapacitySampleResult,
  type CapacitySampleReason,
} from "#shared/capacity/contract.ts";
import {
  assertActive,
  checkpoint,
  type CapacityExecution,
} from "./execution.ts";

type Blocks = { bsize: bigint; blocks: bigint; bavail: bigint };
type RootIdentity = { dev: bigint; ino: bigint };
type RootIOOptions = {
  resolve: (role: CapacityRole) => string;
  statfs?: (root: string) => Promise<Blocks>;
};
type Unavailable = { status: "unavailable"; reason: CapacitySampleReason };
const IOError = z.object({
  code: z.enum([
    "ENOENT",
    "ENOTDIR",
    "EACCES",
    "EPERM",
    "EIO",
    "ESTALE",
    "ETIMEDOUT",
  ]),
});

function knownError(error: unknown, execution: CapacityExecution) {
  assertActive(execution);
  const parsed = IOError.safeParse(error);
  if (!parsed.success) throw error;
  return parsed.data.code;
}

async function inspectRoot(
  root: string,
  execution: CapacityExecution,
): Promise<{ status: "ready"; identity: RootIdentity } | Unavailable> {
  try {
    const identity = await lstat(root, { bigint: true });
    assertActive(execution);
    if (identity.isSymbolicLink())
      return { status: "unavailable", reason: "root_symlink" };
    if (!identity.isDirectory())
      return { status: "unavailable", reason: "root_not_directory" };
    const canonical = await realpath(root);
    assertActive(execution);
    return canonical === root
      ? { status: "ready", identity }
      : { status: "unavailable", reason: "root_changed" };
  } catch (error) {
    const code = knownError(error, execution);
    return {
      status: "unavailable",
      reason:
        code === "ENOENT" || code === "ENOTDIR"
          ? "root_missing"
          : "statfs_failed",
    };
  }
}

function measured(
  capacity: Blocks,
  identity: RootIdentity,
): CapacitySampleResult {
  const totalBytes = capacity.blocks * capacity.bsize;
  const availableBytes = capacity.bavail * capacity.bsize;
  if (
    capacity.bsize <= 0n ||
    totalBytes <= 0n ||
    availableBytes < 0n ||
    availableBytes > totalBytes
  )
    return { status: "unavailable", reason: "capacity_invalid" };
  if (totalBytes > CAPACITY_MAX_BYTES || availableBytes > CAPACITY_MAX_BYTES)
    return { status: "unavailable", reason: "capacity_overflow" };
  return {
    status: "observed",
    observedAt: new Date().toISOString(),
    identity: { device: String(identity.dev), inode: String(identity.ino) },
    totalBytes,
    availableBytes,
  };
}

/** Trusted constructor dependency only; no Workflow or HTTP input selects a path. */
export function createCapacityRootIO(options: RootIOOptions) {
  const measure =
    options.statfs ?? ((root: string) => statfs(root, { bigint: true }));
  return {
    async sample(
      role: CapacityRole,
      execution: CapacityExecution,
    ): Promise<CapacitySampleResult> {
      await checkpoint(execution);
      const root = options.resolve(role);
      const before = await inspectRoot(root, execution);
      if (before.status === "unavailable") return before;
      await checkpoint(execution);
      let capacity;
      try {
        capacity = await measure(root);
      } catch (error) {
        knownError(error, execution);
        return { status: "unavailable", reason: "statfs_failed" };
      }
      await checkpoint(execution);
      const after = await inspectRoot(root, execution);
      await checkpoint(execution);
      return after.status === "unavailable" ||
        before.identity.dev !== after.identity.dev ||
        before.identity.ino !== after.identity.ino
        ? { status: "unavailable", reason: "root_changed" }
        : measured(capacity, after.identity);
    },
  };
}
export type CapacityRootIO = ReturnType<typeof createCapacityRootIO>;
