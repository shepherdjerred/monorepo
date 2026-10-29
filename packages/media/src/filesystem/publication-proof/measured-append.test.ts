import { afterEach, expect, test, vi } from "vitest";
import type * as FsPromises from "node:fs/promises";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { ContentProof } from "#filesystem/content-proof.ts";
import { FileOperations } from "#filesystem/operations.ts";
import {
  measurePublicationNamespace,
  initializeMeasuredPublicationNamespace,
} from "#filesystem/publication-measurement.ts";
import type {
  LockedPublicationEvent,
  PublicationEffect,
} from "#shared/publication-proof/effects.ts";

const boundary = vi.hoisted(
  (): {
    afterStat: ((filename: string) => Promise<void>) | null;
    afterOpen: ((filename: string) => void) | null;
    afterClose: ((filename: string) => void) | null;
    beforeSync: ((filename: string) => void) | null;
    pendingClosed: number;
  } => ({
    afterStat: null,
    afterOpen: null,
    afterClose: null,
    beforeSync: null,
    pendingClosed: 0,
  }),
);

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const result = await actual.lstat(...args);
      await boundary.afterStat?.(String(args[0]));
      return result;
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const filename = String(args[0]);
      const close = handle.close.bind(handle);
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        boundary.beforeSync?.(filename);
        await sync();
      };
      handle.close = async () => {
        await close();
        if (filename.endsWith(".pending")) boundary.pendingClosed++;
        boundary.afterClose?.(filename);
      };
      boundary.afterOpen?.(filename);
      return handle;
    },
  };
});

const directories: string[] = [];
afterEach(async () => {
  boundary.afterStat = null;
  boundary.afterOpen = null;
  boundary.afterClose = null;
  boundary.beforeSync = null;
  boundary.pendingClosed = 0;
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const digest = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");

test.each(["expiry", "cancel"] as const)(
  "%s during real directory open prevents fsync dispatch and ACK while closing both handles",
  async (mode) => {
    const f = await fixture();
    const cancelled = new Error("Cancelled during directory open");
    let directoryOpens = 0,
      directorySyncs = 0,
      directoryCloses = 0;
    boundary.afterOpen = (filename) => {
      if (filename !== f.namespace) return;
      directoryOpens++;
      if (mode === "expiry") f.expire();
      else f.controller.abort(cancelled);
    };
    boundary.beforeSync = (filename) => {
      if (filename === f.namespace) directorySyncs++;
    };
    boundary.afterClose = (filename) => {
      if (filename === f.namespace) directoryCloses++;
    };
    await expect(f.initialized.store.append(f.record)).rejects.toBe(
      mode === "expiry" ? f.expired : cancelled,
    );
    expect(directoryOpens).toBe(1);
    expect(directorySyncs).toBe(0);
    expect(directoryCloses).toBe(1);
    expect(boundary.pendingClosed).toBe(1);
    const names = await readdir(f.namespace);
    expect(names).toHaveLength(2);
    expect(names).toContain("00000000.json");
    expect(names.filter((name) => name.endsWith(".pending"))).toHaveLength(1);
    for (const name of names)
      expect(await readFile(path.join(f.namespace, name), "utf8")).toBe(
        JSON.stringify(f.record),
      );
  },
);

async function fixture() {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "media-measured-append-")),
  );
  directories.push(directory);
  const roots = {
    library: path.join(directory, "library"),
    control: path.join(directory, "control"),
    downloads: path.join(directory, "downloads"),
  };
  for (const root of Object.values(roots)) await mkdir(root);
  for (const name of ["staging", "rollback", "journal", "quarantine"])
    await mkdir(path.join(roots.control, name));
  await writeFile(path.join(roots.downloads, "new.mkv"), "new");
  await writeFile(path.join(roots.library, "movie.mkv"), "old");
  const input = {
    operationId: "import-video",
    downloadPath: "new.mkv",
    libraryPath: "movie.mkv",
    sha256: digest("new"),
    previousSha256: digest("old"),
  };
  await new FileOperations(roots, {
    authorize: () => Promise.resolve(),
    minimumFreeBytes: 0,
  }).importFile({ ...input, stopAfterStaging: true });
  const proof = new ContentProof();
  const paths = [
    { root: "library", path: "movie.mkv" },
    { root: "control", path: "staging/import-video" },
    { root: "control", path: "rollback/import-video" },
  ] as const;
  for (const item of paths)
    await proof.capture(path.join(roots[item.root], item.path), () =>
      Promise.resolve(),
    );
  proof.seal();
  const events: LockedPublicationEvent[] = [];
  const physical = new FileOperations(roots, {
    authorize: () => Promise.resolve(),
    minimumFreeBytes: 0,
    contentProof: proof,
    effectRecorder: {
      assertActive: () => proof.assertActive(),
      acknowledge: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    },
  });
  await physical.withContentPaths(paths, () => physical.importFile(input), [
    input.operationId,
  ]);
  const effect = events[0];
  if (effect === undefined) throw new Error("Actual physical event missing");
  const transitionId = crypto.randomUUID(),
    continuationId = crypto.randomUUID();
  const parent = path.join(
    roots.control,
    "publication-transitions",
    transitionId,
  );
  await mkdir(parent, { recursive: true });
  const namespace = path.join(parent, `compensation-${continuationId}`);
  const controller = new AbortController();
  const expired = new Error("Original measured-store deadline expired");
  let valid = true;
  const assertActive = () => {
    controller.signal.throwIfAborted();
    if (!valid) throw expired;
  };
  const measured = await measurePublicationNamespace(roots, {
    transitionId,
    continuationId,
    maxRecords: 20,
    maxRecordBytes: 65_536,
    assertActive,
    checkpoint: () => Promise.resolve(),
  });
  const initialized = await initializeMeasuredPublicationNamespace(measured, {
    assertActive,
    assertCurrent: () => Promise.resolve(),
  });
  const record: PublicationEffect = {
    schemaVersion: 1,
    transitionId,
    continuationId,
    intentHash: digest("fixture intent"),
    ordinal: 0,
    previousEffectHash: null,
    entryOperationId: input.operationId,
    assetId: crypto.randomUUID(),
    subtitleId: null,
    libraryKind: "movies",
    effect,
  };
  return {
    initialized,
    namespace,
    record,
    expired,
    controller,
    expire: () => {
      valid = false;
    },
  };
}

test("initialized measured store preserves a successful literal record and its actual stat proof", async () => {
  const f = await fixture();
  const ack = await f.initialized.store.append(f.record);
  expect(ack.effectHash).toBe(digest(JSON.stringify(f.record)));
  expect(await readFile(path.join(f.namespace, "00000000.json"), "utf8")).toBe(
    JSON.stringify(f.record),
  );
  await f.initialized.observed.assertUnchanged([ack.proof]);
  expect(await readdir(f.namespace)).toEqual(["00000000.json"]);
});

test.each(["expiry", "cancel"] as const)(
  "%s during the last awaited stat prevents link/unlink/ACK without erasing uncertain artifacts",
  async (mode) => {
    for (const stage of ["link", "unlink", "ack"] as const) {
      const f = await fixture();
      const cancelled = new Error("Original invocation cancelled");
      const failure = mode === "expiry" ? f.expired : cancelled;
      let pendingStats = 0,
        finalStats = 0,
        reached = false;
      boundary.afterStat = async (filename) => {
        if (!filename.startsWith(`${f.namespace}/`)) return;
        if (filename.endsWith(".pending")) pendingStats++;
        if (filename.endsWith("00000000.json")) finalStats++;
        if (
          (stage === "link" && pendingStats === 1) ||
          (stage === "unlink" && pendingStats === 2) ||
          (stage === "ack" && finalStats === 2)
        ) {
          reached = true;
          // A real lstat has completed; revoke the original guard before its continuation resumes.
          await Promise.resolve();
          if (mode === "expiry") f.expire();
          else f.controller.abort(cancelled);
        }
      };
      await expect(f.initialized.store.append(f.record)).rejects.toBe(failure);
      boundary.afterStat = null;
      expect(reached).toBe(true);
      const names = await readdir(f.namespace);
      const pending = names.filter((name) => name.endsWith(".pending"));
      expect(pending).toHaveLength(stage === "ack" ? 0 : 1);
      expect(names.includes("00000000.json")).toBe(stage !== "link");
      if (stage !== "link")
        expect(
          await readFile(path.join(f.namespace, "00000000.json"), "utf8"),
        ).toBe(JSON.stringify(f.record));
      for (const name of pending)
        expect(await readFile(path.join(f.namespace, name), "utf8")).toBe(
          JSON.stringify(f.record),
        );
    }
  },
);

test.each(["expiry", "cancel"] as const)(
  "%s after temporary open closes its handle but neither writes nor removes the uncertain file",
  async (mode) => {
    const f = await fixture();
    const cancelled = new Error("Original invocation cancelled");
    boundary.afterOpen = (filename) => {
      if (!filename.endsWith(".pending")) return;
      if (mode === "expiry") f.expire();
      else f.controller.abort(cancelled);
    };
    await expect(f.initialized.store.append(f.record)).rejects.toBe(
      mode === "expiry" ? f.expired : cancelled,
    );
    boundary.afterOpen = null;
    expect(boundary.pendingClosed).toBe(1);
    const names = await readdir(f.namespace);
    expect(names).toHaveLength(1);
    const pending = names[0];
    if (pending === undefined)
      throw new Error("Uncertain pending artifact missing");
    expect(pending.endsWith(".pending")).toBe(true);
    expect(await readFile(path.join(f.namespace, pending), "utf8")).toBe("");
  },
);

test("cancellation during final close refuses ACK while preserving installed literal record bytes", async () => {
  const f = await fixture();
  const cancelled = new Error("Cancelled during close");
  boundary.afterClose = (filename) => {
    if (filename.endsWith(".pending")) f.controller.abort(cancelled);
  };
  await expect(f.initialized.store.append(f.record)).rejects.toBe(cancelled);
  boundary.afterClose = null;
  expect(boundary.pendingClosed).toBe(1);
  expect(await readdir(f.namespace)).toEqual(["00000000.json"]);
  expect(await readFile(path.join(f.namespace, "00000000.json"), "utf8")).toBe(
    JSON.stringify(f.record),
  );
});
