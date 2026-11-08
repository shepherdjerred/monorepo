import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { FileOperations } from "./operations.ts";
import { sha256File } from "./operations-io.ts";
import type { MediaFileRoots } from "./operations-types.ts";
import { FileLockError } from "./advisory-lock.ts";

const temporaryRoots: string[] = [];
const authorize = async () => {
  /* Tests supply an explicit authoritative decision. */
};
afterEach(async () => {
  for (const root of temporaryRoots.splice(0))
    await rm(root, { recursive: true, force: true });
});
function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture(): Promise<MediaFileRoots> {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "media-files-test-"),
  );
  temporaryRoots.push(root);
  const roots = {
    downloads: path.join(root, "downloads"),
    library: path.join(root, "library"),
    control: path.join(root, "control"),
  };
  await Promise.all(
    Object.values(roots).map(async (rootPath) => await mkdir(rootPath)),
  );
  await writeFile(path.join(roots.downloads, "new.mkv"), "new version");
  return roots;
}

it("cancels a large staging copy between chunks and safely resumes the journal", async () => {
  const roots = await fixture();
  const bytes = new Uint8Array(4 * 1024 * 1024).fill(42);
  await writeFile(path.join(roots.downloads, "new.mkv"), bytes);
  const input = {
    operationId: "cancel-copy",
    downloadPath: "new.mkv",
    libraryPath: "movie.mkv",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  let chunks = 0;
  const interrupted = new FileOperations(roots, {
    authorize,
    minimumFreeBytes: 0,
    checkpoint: async (phase) => {
      if (phase === "copying" && ++chunks === 3) throw new Error("cancelled");
    },
  });
  await expect(interrupted.importFile(input)).rejects.toThrow("cancelled");
  const partial = await readFile(
    path.join(roots.control, "staging/cancel-copy.partial"),
  );
  expect(partial.length).toBe(2 * 1024 * 1024);
  await expect(
    readFile(path.join(roots.library, "movie.mkv")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    new FileOperations(roots, { authorize, minimumFreeBytes: 0 }).importFile(
      input,
    ),
  ).resolves.toMatchObject({ phase: "complete" });
  expect(await sha256File(path.join(roots.library, "movie.mkv"))).toBe(
    input.sha256,
  );
});
it("atomically rolls back an upgrade and recovers after publication without losing either version", async () => {
  const roots = await fixture();
  await writeFile(path.join(roots.library, "movie.mkv"), "old version");
  const input = {
    operationId: "upgrade1",
    downloadPath: "new.mkv",
    libraryPath: "movie.mkv",
    sha256: digest("new version"),
    previousSha256: digest("old version"),
  };
  const operations = new FileOperations(roots, {
    authorize,
    minimumFreeBytes: 0,
  });
  await operations.importFile(input);
  const interrupted = new FileOperations(roots, {
    authorize,
    checkpoint: async (phase) => {
      if (phase === "rollback-published") throw new Error("interrupted");
    },
  });
  const rollback = { ...input, rollbackOperationId: "rollback1" };
  await expect(interrupted.rollbackImport(rollback)).rejects.toThrow(
    "interrupted",
  );
  await expect(operations.rollbackImport(rollback)).resolves.toMatchObject({
    phase: "complete",
    kind: "rollback",
  });
  expect(await readFile(path.join(roots.library, "movie.mkv"), "utf8")).toBe(
    "old version",
  );
  expect(
    await readFile(path.join(roots.control, "rollback/rollback1"), "utf8"),
  ).toBe("new version");
});
it("permits nested control only with exact markers and fresh authoritative exclusion proof", async () => {
  const base = await fixture();
  const roots: MediaFileRoots = {
    ...base,
    control: path.join(base.library, ".media-control"),
    controlPolicy: "plex-excluded",
  };
  await mkdir(roots.control);
  expect(() => new FileOperations(roots, { authorize })).toThrow(
    "verified Plex",
  );
  let proven = false;
  const operations = new FileOperations(roots, {
    authorize,
    minimumFreeBytes: 0,
    verifyPlexExclusion: async () => {
      if (!proven) throw new Error("No scanner proof");
    },
  });
  const input = {
    operationId: "excluded1",
    downloadPath: "new.mkv",
    libraryPath: "movie.mkv",
    sha256: digest("new version"),
  };
  await expect(operations.importFile(input)).rejects.toThrow();
  await writeFile(
    path.join(roots.library, ".plexignore"),
    ".media-control/*\n",
  );
  await writeFile(path.join(roots.control, ".plexignore"), "*\n");
  await expect(operations.importFile(input)).rejects.toThrow("scanner proof");
  proven = true;
  await expect(
    operations.importFile({ ...input, stopAfterStaging: true }),
  ).resolves.toMatchObject({ phase: "staged" });
  await writeFile(path.join(roots.library, ".plexignore"), "different/*\n");
  await expect(operations.importFile(input)).rejects.toThrow("markers");
  await expect(
    readFile(path.join(roots.library, "movie.mkv")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
it("stages separately then resumes the same manifest to publish", async () => {
  const roots = await fixture();
  let authorizations = 0;
  const operations = new FileOperations(roots, {
    authorize: async () => {
      authorizations += 1;
    },
    minimumFreeBytes: 0,
  });
  const input = {
    operationId: "stage1",
    downloadPath: "new.mkv",
    libraryPath: "movie.mkv",
    sha256: digest("new version"),
  };
  await expect(
    operations.importFile({ ...input, stopAfterStaging: true }),
  ).resolves.toMatchObject({ phase: "staged" });
  await expect(
    readFile(path.join(roots.library, "movie.mkv")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(authorizations).toBe(0);
  await expect(operations.importFile(input)).resolves.toMatchObject({
    phase: "complete",
  });
  expect(authorizations).toBeGreaterThan(0);
});
it("imports and retries without altering the seeding source", async () => {
  const roots = await fixture();
  const operations = new FileOperations(roots, {
    authorize,
    minimumFreeBytes: 0,
  });
  const input = {
    operationId: "import1",
    downloadPath: "new.mkv",
    libraryPath: "Movie (2020)/movie.mkv",
    sha256: digest("new version"),
  };
  await expect(operations.importFile(input)).resolves.toMatchObject({
    phase: "complete",
  });
  await expect(operations.importFile(input)).resolves.toMatchObject({
    phase: "complete",
  });
  expect(await readFile(path.join(roots.downloads, "new.mkv"), "utf8")).toBe(
    "new version",
  );
  expect(
    await readFile(path.join(roots.library, input.libraryPath), "utf8"),
  ).toBe("new version");
});

it("recovers after publication but before completion and preserves the old version", async () => {
  const roots = await fixture();
  await writeFile(path.join(roots.library, "movie.mkv"), "old version");
  const input = {
    operationId: "upgrade1",
    downloadPath: "new.mkv",
    libraryPath: "movie.mkv",
    sha256: digest("new version"),
    previousSha256: digest("old version"),
  };
  const interrupted = new FileOperations(roots, {
    authorize,
    minimumFreeBytes: 0,
    checkpoint: async (phase) => {
      if (phase === "published")
        throw new Error("simulated activity interruption");
    },
  });
  await expect(interrupted.importFile(input)).rejects.toThrow("interruption");
  await expect(interrupted.readManifest("upgrade1")).resolves.toMatchObject({
    phase: "staged",
  });
  const recovered = new FileOperations(roots, {
    authorize,
    minimumFreeBytes: 0,
  });
  await recovered.importFile(input);
  expect(
    await readFile(path.join(roots.control, "rollback/upgrade1"), "utf8"),
  ).toBe("old version");
  expect(await readFile(path.join(roots.library, "movie.mkv"), "utf8")).toBe(
    "new version",
  );
});

it("never replaces unexpected existing content", async () => {
  const roots = await fixture();
  await writeFile(path.join(roots.library, "movie.mkv"), "unmanaged file");
  const operations = new FileOperations(roots, {
    authorize,
    minimumFreeBytes: 0,
  });
  await expect(
    operations.importFile({
      operationId: "import2",
      downloadPath: "new.mkv",
      libraryPath: "movie.mkv",
      sha256: digest("new version"),
    }),
  ).rejects.toThrow("unrecognized");
  expect(await readFile(path.join(roots.library, "movie.mkv"), "utf8")).toBe(
    "unmanaged file",
  );
});

it("rejects corrupted copies and operation identifier reuse", async () => {
  const roots = await fixture();
  const operations = new FileOperations(roots, {
    authorize,
    minimumFreeBytes: 0,
  });
  const input = {
    operationId: "import3",
    downloadPath: "new.mkv",
    libraryPath: "movie.mkv",
    sha256: digest("wrong content"),
  };
  await expect(operations.importFile(input)).rejects.toThrow("manifest");
  await expect(
    operations.importFile({ ...input, sha256: digest("new version") }),
  ).rejects.toThrow("reused");
});

it("recovers quarantine after unlink, then restores the exact file", async () => {
  const roots = await fixture();
  await writeFile(path.join(roots.library, "movie.mkv"), "old version");
  const input = {
    operationId: "quarantine1",
    quarantineId: "asset1",
    libraryPath: "movie.mkv",
    sha256: digest("old version"),
  };
  const interrupted = new FileOperations(roots, {
    authorize,
    checkpoint: async (phase) => {
      if (phase === "move-unlinked") throw new Error("simulated interruption");
    },
  });
  await expect(interrupted.quarantine(input)).rejects.toThrow("interruption");
  const operations = new FileOperations(roots, { authorize });
  await expect(operations.quarantine(input)).resolves.toMatchObject({
    phase: "complete",
  });
  await expect(
    operations.restore({ ...input, operationId: "restore1" }),
  ).resolves.toMatchObject({ phase: "complete" });
  expect(await readFile(path.join(roots.library, "movie.mkv"), "utf8")).toBe(
    "old version",
  );
});

it("purges only a matching quarantined file and repeats safely", async () => {
  const roots = await fixture();
  await writeFile(path.join(roots.library, "movie.mkv"), "old version");
  const operations = new FileOperations(roots, { authorize });
  await operations.quarantine({
    operationId: "quarantine1",
    quarantineId: "asset1",
    libraryPath: "movie.mkv",
    sha256: digest("old version"),
  });
  const input = {
    operationId: "purge1",
    quarantineId: "asset1",
    sha256: digest("old version"),
  };
  await operations.purge(input);
  await operations.purge(input);
  await writeFile(
    path.join(roots.control, "quarantine/asset1"),
    "unrelated new content",
  );
  await expect(operations.purge(input)).rejects.toThrow("reused");
  expect(
    await readFile(path.join(roots.control, "quarantine/asset1"), "utf8"),
  ).toBe("unrelated new content");
});

it("rejects traversal, symlink parents, and nested control roots", async () => {
  const roots = await fixture();
  const operations = new FileOperations(roots, {
    authorize,
    minimumFreeBytes: 0,
  });
  const input = {
    operationId: "import1",
    downloadPath: "new.mkv",
    libraryPath: "../escaped.mkv",
    sha256: digest("new version"),
  };
  await expect(operations.importFile(input)).rejects.toThrow("relative");
  await symlink(roots.downloads, path.join(roots.library, "escape"));
  await expect(
    operations.importFile({ ...input, libraryPath: "escape/movie.mkv" }),
  ).rejects.toThrow("path type");
  expect(
    () =>
      new FileOperations(
        { ...roots, control: path.join(roots.library, ".media") },
        { authorize },
      ),
  ).toThrow("disjoint");
});

it("rechecks authority after staging and leaves the previous playable version untouched", async () => {
  const roots = await fixture();
  await writeFile(path.join(roots.library, "movie.mkv"), "old version");
  let allowed = true;
  const operations = new FileOperations(roots, {
    minimumFreeBytes: 0,
    authorize: async () => {
      if (!allowed) throw new Error("generation changed");
    },
    checkpoint: async (phase) => {
      if (phase === "staged") allowed = false;
    },
  });
  await expect(
    operations.importFile({
      operationId: "upgrade2",
      downloadPath: "new.mkv",
      libraryPath: "movie.mkv",
      sha256: digest("new version"),
      previousSha256: digest("old version"),
    }),
  ).rejects.toThrow("generation changed");
  expect(await readFile(path.join(roots.library, "movie.mkv"), "utf8")).toBe(
    "old version",
  );
});

it.each(["previous-version-preserved", "published"])(
  "recovers from a killed worker at %s without stale-lock theft",
  async (phase) => {
    const roots = await fixture();
    await writeFile(path.join(roots.library, "movie.mkv"), "old version");
    const input = {
      operationId: "crash1",
      downloadPath: "new.mkv",
      libraryPath: "movie.mkv",
      sha256: digest("new version"),
      previousSha256: digest("old version"),
    };
    const child = spawn(
      process.execPath,
      [
        "run",
        fileURLToPath(new URL("crash.fixture.ts", import.meta.url)),
        JSON.stringify({ roots, input, phase }),
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const exit = new Promise<void>((resolve) => {
      child.once("exit", () => {
        resolve();
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Crash fixture did not reach checkpoint"));
        }, 5000);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          if (chunk.includes("ready")) {
            clearTimeout(timeout);
            resolve();
          }
        });
        child.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once("exit", () => {
          clearTimeout(timeout);
          reject(new Error("Crash fixture exited before checkpoint"));
        });
      });
      child.kill("SIGKILL");
      await exit;
      const expected = phase === "published" ? "new version" : "old version";
      expect(
        await readFile(path.join(roots.library, "movie.mkv"), "utf8"),
      ).toBe(expected);
      const recovered = new FileOperations(roots, {
        authorize,
        minimumFreeBytes: 0,
      });
      // EOF releases each orphan helper's kernel lock; allow bounded process-exit propagation.
      for (let attempt = 0; ; attempt += 1) {
        try {
          await recovered.importFile(input);
          break;
        } catch (error) {
          if (
            !(error instanceof FileLockError) ||
            error.kind !== "busy" ||
            attempt >= 20
          )
            throw error;
          await delay(10);
        }
      }
      expect(
        await readFile(path.join(roots.library, "movie.mkv"), "utf8"),
      ).toBe("new version");
      expect(
        await readFile(path.join(roots.control, "rollback/crash1"), "utf8"),
      ).toBe("old version");
    } finally {
      child.kill("SIGKILL");
      await exit;
    }
  },
);
