import {
  mkdtemp,
  mkdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { createCapacityRootIO } from "./io.ts";
import type { CapacityExecution } from "./execution.ts";

const directories: string[] = [];
async function fixture() {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "media-capacity-io-")),
  );
  directories.push(directory);
  const root = path.join(directory, "library");
  await mkdir(root);
  return { root, directory };
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
function execution(): CapacityExecution {
  const signal = new AbortController().signal;
  return {
    signal,
    checkpoint: () => Promise.resolve(),
    assertActive: () => {
      signal.throwIfAborted();
    },
  };
}
test("real statfs returns exact bigint capacity and private physical identity", async () => {
  const f = await fixture();
  const result = await createCapacityRootIO({ resolve: () => f.root }).sample(
    "movies",
    execution(),
  );
  expect(result.status).toBe("observed");
  if (result.status !== "observed") throw new Error("Expected actual capacity");
  expect(result.totalBytes).toBeGreaterThan(0n);
  expect(result.availableBytes).toBeLessThanOrEqual(result.totalBytes);
  expect(result.identity.inode).toMatch(/^\d+$/u);
});
test.each([
  ["zero available", { bsize: 4096n, blocks: 10n, bavail: 0n }, "observed"],
  ["negative", { bsize: 4096n, blocks: 10n, bavail: -1n }, "capacity_invalid"],
  [
    "over total",
    { bsize: 4096n, blocks: 10n, bavail: 11n },
    "capacity_invalid",
  ],
  ["zero total", { bsize: 4096n, blocks: 0n, bavail: 0n }, "capacity_invalid"],
  [
    "overflow",
    { bsize: 4096n, blocks: 9_223_372_036_854_775_807n, bavail: 1n },
    "capacity_overflow",
  ],
] as const)(
  "%s is bounded without floating point",
  async (_label, blocks, expected) => {
    const f = await fixture();
    const result = await createCapacityRootIO({
      resolve: () => f.root,
      statfs: () => Promise.resolve(blocks),
    }).sample("movies", execution());
    expect(result.status === "observed" ? result.status : result.reason).toBe(
      expected,
    );
  },
);
test.each(["missing", "symlink", "file"] as const)(
  "rejects %s before statfs",
  async (kind) => {
    const f = await fixture();
    const root = path.join(f.directory, "candidate");
    if (kind === "symlink") await symlink(f.root, root);
    if (kind === "file") await writeFile(root, "not a directory");
    let calls = 0;
    const result = await createCapacityRootIO({
      resolve: () => root,
      statfs: () => {
        calls++;
        throw new Error("Must not measure");
      },
    }).sample("tv", execution());
    expect(result).toEqual({
      status: "unavailable",
      reason:
        kind === "missing"
          ? "root_missing"
          : kind === "symlink"
            ? "root_symlink"
            : "root_not_directory",
    });
    expect(calls).toBe(0);
  },
);
test("directory replacement during measurement is unavailable", async () => {
  const f = await fixture();
  const result = await createCapacityRootIO({
    resolve: () => f.root,
    statfs: async () => {
      await rename(f.root, path.join(f.directory, "previous"));
      await mkdir(f.root);
      return { bsize: 1n, blocks: 10n, bavail: 5n };
    },
  }).sample("movies", execution());
  expect(result).toEqual({ status: "unavailable", reason: "root_changed" });
});
test("cancellation or deadline after unabortable IO cannot return observed", async () => {
  const f = await fixture();
  for (const mode of ["cancel", "deadline"] as const) {
    const controller = new AbortController();
    let expired = false;
    const run = {
      ...execution(),
      signal: controller.signal,
      assertActive: () => {
        if (expired) throw new Error("deadline");
      },
    };
    const io = createCapacityRootIO({
      resolve: () => f.root,
      statfs: () => {
        if (mode === "cancel") controller.abort(new Error("cancelled"));
        else expired = true;
        return Promise.resolve({ bsize: 1n, blocks: 10n, bavail: 5n });
      },
    });
    await expect(io.sample("movies", run)).rejects.toThrow(
      mode === "cancel" ? "cancelled" : "deadline",
    );
  }
  const fresh = await createCapacityRootIO({ resolve: () => f.root }).sample(
    "movies",
    execution(),
  );
  expect(fresh.status).toBe("observed");
});
test("known filesystem failure is unavailable but programming failures remain failures", async () => {
  const f = await fixture();
  const known = createCapacityRootIO({
    resolve: () => f.root,
    statfs: () => {
      throw Object.assign(new Error("private path"), { code: "EIO" });
    },
  });
  expect(await known.sample("movies", execution())).toEqual({
    status: "unavailable",
    reason: "statfs_failed",
  });
  const broken = createCapacityRootIO({
    resolve: () => f.root,
    statfs: () => {
      throw new TypeError("broken dependency");
    },
  });
  await expect(broken.sample("movies", execution())).rejects.toThrow(
    "broken dependency",
  );
});
