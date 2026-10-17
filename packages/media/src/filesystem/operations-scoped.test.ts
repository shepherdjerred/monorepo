import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  rm,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { FileOperations } from "./operations.ts";
import { ContentProof } from "./content-proof.ts";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
async function fixture() {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "media-scoped-lock-")),
  );
  directories.push(directory);
  const roots = {
    downloads: path.join(directory, "downloads"),
    library: path.join(directory, "library"),
    control: path.join(directory, "control"),
  };
  for (const root of Object.values(roots)) await mkdir(root);
  await writeFile(path.join(roots.downloads, "new.srt"), "new");
  await writeFile(path.join(roots.library, "video.en.srt"), "old");
  await writeFile(path.join(roots.library, "video.mkv"), "video");
  const descriptor = {
    operationId: "scoped-import",
    downloadPath: "new.srt",
    libraryPath: "video.en.srt",
    sha256: hash("new"),
    previousSha256: hash("old"),
  };
  await new FileOperations(roots, {
    authorize: () => Promise.resolve(),
    minimumFreeBytes: 0,
  }).importFile({ ...descriptor, stopAfterStaging: true });
  const proof = new ContentProof();
  for (const filename of [
    path.join(roots.library, "video.mkv"),
    path.join(roots.library, "video.en.srt"),
    path.join(roots.control, "staging/scoped-import"),
    path.join(roots.control, "rollback/scoped-import"),
  ])
    await proof.capture(filename, () => Promise.resolve());
  proof.seal();
  const identities = await Promise.all(
    ["video.mkv", "video.en.srt"].map(async (libraryPath) => ({
      ...(await proof.verifiedFile(path.join(roots.library, libraryPath))),
      libraryPath,
    })),
  );
  return { roots, descriptor, proof, identities };
}

it("holds sorted proof locks and performs a nested exact import on the same instance", async () => {
  const f = await fixture();
  const files = new FileOperations(f.roots, {
    authorize: () => Promise.resolve(),
    contentProof: f.proof,
  });
  await files.withFileIdentities(
    f.identities,
    () => files.importFile(f.descriptor),
    [f.descriptor.operationId],
  );
  expect(
    await readFile(path.join(f.roots.library, "video.en.srt"), "utf8"),
  ).toBe("new");
  expect(
    await readFile(
      path.join(f.roots.control, "rollback/scoped-import"),
      "utf8",
    ),
  ).toBe("old");
});

it("rejects concurrent ALS siblings reusing a held operation and does not run their effect", async () => {
  const f = await fixture();
  let enter = uninitializedGate;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let release = uninitializedGate;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let effects = 0;
  const files = new FileOperations(f.roots, {
    authorize: async () => {
      effects++;
      enter();
      await gate;
    },
    contentProof: f.proof,
  });
  await files.withFileIdentities(
    f.identities,
    async () => {
      const first = files.importFile(f.descriptor);
      await entered;
      await expect(files.importFile(f.descriptor)).rejects.toThrow(
        "Concurrent nested",
      );
      release();
      await first;
    },
    [f.descriptor.operationId],
  );
  expect(effects).toBe(2);
});

function uninitializedGate(): void {
  throw new Error("Gate not initialized");
}

it("does not confer scoped lock ownership on another FileOperations instance", async () => {
  const f = await fixture();
  const files = new FileOperations(f.roots, {
    authorize: () => Promise.resolve(),
    contentProof: f.proof,
  });
  const other = new FileOperations(f.roots, {
    authorize: async () => {
      throw new Error("Must not authorize");
    },
  });
  await files.withFileIdentities(
    f.identities,
    async () => {
      await expect(other.importFile(f.descriptor)).rejects.toThrow("lock busy");
    },
    [f.descriptor.operationId],
  );
});

it("rejects additional operation keys beneath an exact proof scope", async () => {
  const f = await fixture();
  const files = new FileOperations(f.roots, {
    authorize: () => Promise.resolve(),
    contentProof: f.proof,
  });
  await files.withFileIdentities(
    f.identities,
    async () => {
      await expect(
        files.importFile({ ...f.descriptor, operationId: "not-scoped" }),
      ).rejects.toThrow("unscoped filesystem lock");
    },
    [f.descriptor.operationId],
  );
});

it("rejects nested, duplicate and empty explicit proof scopes", async () => {
  const f = await fixture();
  const files = new FileOperations(f.roots, {
    authorize: () => Promise.resolve(),
    contentProof: f.proof,
  });
  await expect(
    files.withFileIdentities([], () => Promise.resolve()),
  ).rejects.toThrow("empty or duplicate");
  await expect(
    files.withFileIdentities([...f.identities, ...f.identities], () =>
      Promise.resolve(),
    ),
  ).rejects.toThrow("empty or duplicate");
  await files.withFileIdentities(f.identities, async () => {
    await expect(
      files.withFileIdentities(f.identities, () => Promise.resolve()),
    ).rejects.toThrow("Nested");
  });
});

it("helper death inside a scoped callback cannot return a successful result", async () => {
  const f = await fixture();
  const files = new FileOperations(f.roots, {
    authorize: () => Promise.resolve(),
    contentProof: f.proof,
  });
  const target = path.join(f.roots.library, "video.mkv");
  const lockPath = path.join(f.roots.control, "locks", `${hash(target)}.lock`);
  await expect(
    files.withFileIdentities(f.identities, async () => {
      const rows = execFileSync("ps", ["-axo", "pid=,ppid=,args="], {
        encoding: "utf8",
      }).split("\n");
      const match = rows.find(
        (row) => row.includes(lockPath) && row.includes("lock-helper.py"),
      );
      const ids = match?.trim().match(/^(\d+)\s+(\d+)\s/u);
      if (ids?.[1] === undefined || Number(ids[2]) !== process.pid)
        throw new Error("Exact fixture lock helper missing");
      process.kill(Number(ids[1]), "SIGKILL");
      await delay(30);
      return "must not succeed";
    }),
  ).rejects.toMatchObject({ kind: "lost" });
});
