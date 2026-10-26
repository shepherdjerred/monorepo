import { afterEach, expect, test, vi } from "vitest";
import type * as FsPromises from "node:fs/promises";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  writeFile,
  readFile,
  readdir,
  rename,
  symlink,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { captureContentMeasurement } from "./content-measurement.ts";
import {
  measurePublicationNamespace,
  initializeMeasuredPublicationNamespace,
} from "./publication-measurement.ts";
import { openMeasuredPublicationRecordStore } from "./publication-proof/store.ts";
import { auditAncestors } from "./publication-proof/journal.ts";

const boundary = vi.hoisted(
  (): {
    afterOpen: ((filename: string) => void) | null;
    beforeSync: ((filename: string) => void) | null;
    afterClose: ((filename: string) => void) | null;
  } => ({ afterOpen: null, beforeSync: null, afterClose: null }),
);
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const filename = String(args[0]);
      const sync = handle.sync.bind(handle),
        close = handle.close.bind(handle);
      handle.sync = async () => {
        boundary.beforeSync?.(filename);
        await sync();
      };
      handle.close = async () => {
        await close();
        boundary.afterClose?.(filename);
      };
      boundary.afterOpen?.(filename);
      return handle;
    },
  };
});

const directories: string[] = [];
afterEach(async () => {
  boundary.afterOpen = null;
  boundary.beforeSync = null;
  boundary.afterClose = null;
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test.each(["expiry", "cancel"] as const)(
  "%s during initializer parent-directory open prevents sync and grant but closes the handle",
  async (mode) => {
    const f = await fixture();
    const controller = new AbortController();
    const cancelled = new Error("Original initializer invocation cancelled");
    const assertActive = () => {
      f.clock.assertActive();
      controller.signal.throwIfAborted();
    };
    const measurement = await measurePublicationNamespace(f.roots, {
      ...f.input,
      assertActive,
    });
    let opened = 0,
      synced = 0,
      closed = 0;
    boundary.afterOpen = (filename) => {
      if (filename !== f.parent) return;
      opened++;
      if (mode === "expiry") f.expire();
      else controller.abort(cancelled);
    };
    boundary.beforeSync = (filename) => {
      if (filename === f.parent) synced++;
    };
    boundary.afterClose = (filename) => {
      if (filename === f.parent) closed++;
    };
    await expect(
      initializeMeasuredPublicationNamespace(measurement, {
        ...f.authority,
        assertActive,
      }),
    ).rejects.toBe(mode === "expiry" ? f.expired : cancelled);
    expect(opened).toBe(1);
    expect(synced).toBe(0);
    expect(closed).toBe(1);
    expect(await readdir(f.namespace)).toEqual([]);
    expect(await readFile(f.file, "utf8")).toBe("original bytes");
    // New callbacks cannot revive the expired original measurement after its own mkdir.
    await expect(
      initializeMeasuredPublicationNamespace(measurement, {
        assertActive: () => {
          /* Deliberately newer callback, not the original clock. */
        },
        assertCurrent: () => Promise.resolve(),
      }),
    ).rejects.toBe(mode === "expiry" ? f.expired : cancelled);
  },
);
async function fixture() {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "media-measurement-")),
  );
  directories.push(directory);
  const roots = {
    downloads: path.join(directory, "downloads"),
    library: path.join(directory, "library"),
    control: path.join(directory, "control"),
  };
  for (const root of Object.values(roots)) await mkdir(root);
  const file = path.join(roots.library, "movie.mkv");
  await writeFile(file, "original bytes");
  const transitionId = crypto.randomUUID(),
    continuationId = crypto.randomUUID();
  const parent = path.join(
    roots.control,
    "publication-transitions",
    transitionId,
  );
  await mkdir(parent, { recursive: true });
  const namespace = path.join(parent, `compensation-${continuationId}`);
  let active = true;
  const expired = new Error("Original invocation expired");
  const assertActive = () => {
    if (!active) throw expired;
  };
  const clock = { assertActive, checkpoint: () => Promise.resolve() };
  const authority = { assertActive, assertCurrent: () => Promise.resolve() };
  const input = {
    ...clock,
    transitionId,
    continuationId,
    maxRecords: 20,
    maxRecordBytes: 65_536,
  };
  const references = [
    { root: "library", path: "movie.mkv" },
    { root: "library", path: "absent.mkv" },
  ] as const;
  return {
    directory,
    roots,
    file,
    parent,
    namespace,
    clock,
    authority,
    input,
    references,
    expired,
    expire: () => {
      active = false;
    },
  };
}

test("read-only measurement exposes facts but no mutation capability, and rejected authority writes nothing", async () => {
  const f = await fixture();
  const content = await captureContentMeasurement(
    f.roots,
    f.references,
    f.clock,
  );
  const namespace = await measurePublicationNamespace(f.roots, f.input);
  expect("link" in content).toBe(false);
  expect("unlink" in content).toBe(false);
  const measured = await content.inspect(f.references[0]);
  expect(measured.file?.sizeBytes).toBe(
    String(Buffer.byteLength("original bytes")),
  );
  const denied = new Error("Full owner authority rejected");
  const authority = {
    ...f.authority,
    assertCurrent: () => Promise.reject(denied),
  };
  await expect(content.seal(authority)).rejects.toBe(denied);
  expect("initialize" in namespace).toBe(false);
  expect(() =>
    initializeMeasuredPublicationNamespace({ ...namespace }, f.authority),
  ).toThrow("actual measurement");
  await expect(
    initializeMeasuredPublicationNamespace(namespace, authority),
  ).rejects.toBe(denied);
  expect(await readFile(f.file, "utf8")).toBe("original bytes");
  expect(await readdir(f.parent)).toEqual([]);
});

test.each(["../outside", "/absolute", "a/../movie.mkv"])(
  "invalid measured path %s fails before content or namespace writes",
  async (relative) => {
    const f = await fixture();
    await expect(
      captureContentMeasurement(
        f.roots,
        [{ root: "library", path: relative }],
        f.clock,
      ),
    ).rejects.toThrow();
    expect(await readdir(f.parent)).toEqual([]);
    expect(await readFile(f.file, "utf8")).toBe("original bytes");
  },
);

test("symlinked roots and media leaves cannot become measurements", async () => {
  const f = await fixture();
  const alias = path.join(f.directory, "alias");
  await symlink(f.roots.library, alias);
  await expect(
    captureContentMeasurement(
      { ...f.roots, library: alias },
      f.references,
      f.clock,
    ),
  ).rejects.toThrow("symbolic");
  await symlink(f.file, path.join(f.roots.library, "linked.mkv"));
  await expect(
    captureContentMeasurement(
      f.roots,
      [{ root: "library", path: "linked.mkv" }],
      f.clock,
    ),
  ).rejects.toThrow("path type");
});

test.each(["bytes", "absence", "parent"] as const)(
  "%s drift after hashing refuses seal",
  async (changed) => {
    const f = await fixture();
    const measured = await captureContentMeasurement(
      f.roots,
      f.references,
      f.clock,
    );
    if (changed === "bytes") await writeFile(f.file, "replaced bytes");
    if (changed === "absence")
      await writeFile(path.join(f.roots.library, "absent.mkv"), "foreign");
    if (changed === "parent") {
      await rename(f.roots.library, `${f.roots.library}-old`);
      await mkdir(f.roots.library);
      await writeFile(f.file, "original bytes");
    }
    await expect(measured.seal(f.authority)).rejects.toThrow();
  },
);

test("original expiry during full authority lookup cannot be renewed by sealing", async () => {
  const f = await fixture();
  const measured = await captureContentMeasurement(
    f.roots,
    f.references,
    f.clock,
  );
  await expect(
    measured.seal({
      assertActive: () => {
        /* A later guard cannot replace the original deadline. */
      },
      assertCurrent: () => {
        f.expire();
        return Promise.resolve();
      },
    }),
  ).rejects.toBe(f.expired);
});

test("a sealed measurement retains original expiry and cannot be sealed again", async () => {
  const f = await fixture();
  const measured = await captureContentMeasurement(
    f.roots,
    f.references,
    f.clock,
  );
  const proof = await measured.seal(f.authority);
  expect(await proof.digest(f.file)).not.toBeNull();
  await expect(measured.seal(f.authority)).rejects.toThrow("already sealed");
  f.expire();
  await expect(proof.unlink(f.file)).rejects.toBe(f.expired);
  expect(await readFile(f.file, "utf8")).toBe("original bytes");
});

test("full authority creates only the measured absent namespace and records its real empty identity", async () => {
  const f = await fixture();
  const measured = await measurePublicationNamespace(f.roots, f.input);
  expect(await readdir(f.parent)).toEqual([]);
  let authorized = false;
  const initialized = await initializeMeasuredPublicationNamespace(measured, {
    ...f.authority,
    assertCurrent: () => {
      authorized = true;
      return Promise.resolve();
    },
  });
  expect(authorized).toBe(true);
  expect(await readdir(f.namespace)).toEqual([]);
  expect(initialized.observed.records).toEqual([]);
  await initialized.observed.assertUnchanged();
  await expect(measured.assertUnchanged()).rejects.toThrow("identity changed");
  await expect(
    initializeMeasuredPublicationNamespace(measured, f.authority),
  ).rejects.toThrow("already consumed");
  await writeFile(path.join(f.namespace, "foreign"), "foreign");
  await expect(initialized.observed.assertUnchanged()).rejects.toThrow(
    "empty transition",
  );
});

test.each(["empty", "populated", "alias"] as const)(
  "a foreign %s namespace appearing after measurement is never adopted",
  async (changed) => {
    const f = await fixture();
    const measured = await measurePublicationNamespace(f.roots, f.input);
    if (changed === "alias") await symlink(f.roots.library, f.namespace);
    else {
      await mkdir(f.namespace);
      if (changed === "populated")
        await writeFile(path.join(f.namespace, "foreign"), "foreign");
    }
    await expect(
      initializeMeasuredPublicationNamespace(measured, f.authority),
    ).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe("original bytes");
  },
);

test("namespace expiry after authorization causes zero initialization writes", async () => {
  const f = await fixture();
  const measured = await measurePublicationNamespace(f.roots, f.input);
  await expect(
    initializeMeasuredPublicationNamespace(measured, {
      assertActive: () => {
        /* A later guard cannot replace the original deadline. */
      },
      assertCurrent: () => {
        f.expire();
        return Promise.resolve();
      },
    }),
  ).rejects.toBe(f.expired);
  expect(await readdir(f.parent)).toEqual([]);
});

test("a previous empty namespace requires new authority and preserves its actual inode", async () => {
  const f = await fixture();
  await mkdir(f.namespace);
  const before = await lstat(f.namespace, { bigint: true });
  const measured = await measurePublicationNamespace(f.roots, f.input);
  const denied = new Error("new authority required");
  await expect(
    initializeMeasuredPublicationNamespace(measured, {
      ...f.authority,
      assertCurrent: () => Promise.reject(denied),
    }),
  ).rejects.toBe(denied);
  const initialized = await initializeMeasuredPublicationNamespace(
    measured,
    f.authority,
  );
  const after = await lstat(f.namespace, { bigint: true });
  expect({ dev: after.dev, ino: after.ino }).toEqual({
    dev: before.dev,
    ino: before.ino,
  });
  await initialized.observed.assertUnchanged();
});

test("existing malformed record bytes are not waived by an old directory", async () => {
  const f = await fixture();
  await mkdir(f.namespace);
  await writeFile(path.join(f.namespace, "00000000.json"), "{}");
  await expect(measurePublicationNamespace(f.roots, f.input)).rejects.toThrow();
  expect(await readFile(path.join(f.namespace, "00000000.json"), "utf8")).toBe(
    "{}",
  );
});

test.each(["foreign", "replaced"] as const)(
  "measured store opening refuses %s namespace facts without writing",
  async (changed) => {
    const f = await fixture();
    await mkdir(f.namespace);
    const ancestors = await auditAncestors(path.join(f.namespace, "record"));
    if (changed === "replaced") {
      await rename(f.namespace, `${f.namespace}-old`);
      await mkdir(f.namespace);
    }
    await expect(
      openMeasuredPublicationRecordStore(f.roots, {
        ...f.input,
        continuationId:
          changed === "foreign" ? crypto.randomUUID() : f.input.continuationId,
        namespace: {
          directory: f.namespace,
          ancestors,
          assertUnchanged: () => Promise.resolve(),
        },
      }),
    ).rejects.toThrow();
    expect(await readdir(f.namespace)).toEqual([]);
  },
);
