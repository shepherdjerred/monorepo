import { afterEach, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
  access,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { FileOperations } from "#filesystem/operations.ts";
import {
  FileOperationConflict,
  ManifestSchema,
} from "#filesystem/operations-types.ts";
import { ContentProof } from "#filesystem/content-proof.ts";
import { saveManifest } from "#filesystem/operations-io.ts";
import { OperationJournal } from "#filesystem/operations/journal.ts";
import type * as FsPromises from "node:fs/promises";
import type * as ContentProofModule from "#filesystem/content-proof.ts";

const observation = vi.hoisted(
  (): {
    afterStat: ((filename: string) => void) | null;
    beforeCapture: ((filename: string) => Promise<void>) | null;
    reads:
      | {
          filename: string;
          read: MockInstance<FsPromises.FileHandle["read"]>;
        }[]
      | null;
  } => ({
    afterStat: null,
    beforeCapture: null,
    reads: null,
  }),
);
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      observation.reads?.push({
        filename: String(args[0]),
        read: vi.spyOn(handle, "read"),
      });
      return handle;
    },
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      try {
        return await actual.lstat(...args);
      } finally {
        observation.afterStat?.(String(args[0]));
      }
    },
  };
});

vi.mock("#filesystem/content-proof.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof ContentProofModule>();
  return {
    ...actual,
    ContentProof: class extends actual.ContentProof {
      override async capture(
        filename: string,
        checkpoint: () => Promise<void>,
      ) {
        await observation.beforeCapture?.(filename);
        return await super.capture(filename, checkpoint);
      }
    },
  };
});

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  observation.afterStat = null;
  observation.beforeCapture = null;
  observation.reads = null;
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

it("fresh preparation reads source and target media exactly once each", async () => {
  const f = await fixture();
  const bytes = f.bytes.repeat(Math.ceil((3 * 1024 * 1024) / f.bytes.length));
  const source = path.join(f.roots.downloads, f.input.downloadPath);
  await writeFile(source, bytes);
  observation.reads = [];
  await f.files.prepareImport({
    ...f.input,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  const totals = new Map<string, number>();
  for (const observed of observation.reads) {
    if (observed.filename !== source && observed.filename !== f.partial)
      continue;
    for (const call of observed.read.mock.results) {
      if (call.type !== "return")
        throw new Error("Expected successful native media reads");
      const read = await call.value;
      totals.set(
        observed.filename,
        (totals.get(observed.filename) ?? 0) + read.bytesRead,
      );
    }
  }
  expect({
    source: totals.get(source),
    partial: totals.get(f.partial),
  }).toEqual({
    source: Buffer.byteLength(bytes),
    partial: Buffer.byteLength(bytes),
  });
  expect(JSON.parse(await readFile(f.journal, "utf8"))).toHaveProperty(
    "preparedPartial",
  );
});

it.each(["same", "different"])(
  "cold preparation preserves a foreign %s-byte partial",
  async (kind) => {
    const f = await fixture();
    await f.files.prepareImport(f.input);
    const replacement = `${f.partial}.foreign`;
    const bytes = kind === "same" ? f.bytes : "Foreign unrelated bytes";
    await writeFile(replacement, bytes);
    await rename(replacement, f.partial);
    const before = await lstat(f.partial, { bigint: true });
    const journal = await readFile(f.journal, "utf8");
    await expect(
      new FileOperations(f.roots, f.options).prepareImport(f.input),
    ).rejects.toBeInstanceOf(FileOperationConflict);
    const after = await lstat(f.partial, { bigint: true });
    expect({ inode: after.ino, device: after.dev }).toEqual({
      inode: before.ino,
      device: before.dev,
    });
    expect(await readFile(f.partial, "utf8")).toBe(bytes);
    expect(await readFile(f.journal, "utf8")).toBe(journal);
    await expect(access(f.staged)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      access(path.join(f.roots.library, f.input.libraryPath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("checks invocation authority after the final awaited staged-path stat before rename", async () => {
  const f = await fixture();
  const prepared = await f.files.prepareImport(f.input);
  let armed = false;
  let reached = false;
  observation.afterStat = (filename) => {
    if (armed && filename === f.staged) reached = true;
  };
  const renameSpy = vi
    .spyOn(ContentProof.prototype, "rename")
    .mockImplementation(function (this: ContentProof, ...args) {
      renameSpy.mockRestore();
      armed = true;
      return this.rename(...args);
    });
  await expect(
    f.files.commitPreparedImport(prepared, {
      ...f.authority,
      beforeEffect: () => {
        if (reached)
          throw new Error("Invocation expired during final staged-path stat");
      },
    }),
  ).rejects.toThrow("Invocation expired during final staged-path stat");
  expect(reached).toBe(true);
  expect(await readFile(f.partial, "utf8")).toBe(f.bytes);
  await expect(access(f.staged)).rejects.toMatchObject({ code: "ENOENT" });
  expect(JSON.parse(await readFile(f.journal, "utf8"))).toMatchObject({
    phase: "prepared",
  });
});
async function fixture() {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "media-choice-staging-")),
  );
  directories.push(directory);
  const roots = {
    downloads: path.join(directory, "downloads"),
    library: path.join(directory, "library"),
    control: path.join(directory, "control"),
  };
  for (const root of Object.values(roots)) await mkdir(root);
  const bytes = "Actual staged media bytes";
  await writeFile(path.join(roots.downloads, "video.mkv"), bytes);
  const input = {
    operationId: crypto.randomUUID(),
    downloadPath: "video.mkv",
    libraryPath: "movie/video.mkv",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const options = { authorize: () => Promise.resolve(), minimumFreeBytes: 0 };
  const files = new FileOperations(roots, options);
  const authority = {
    authorize: () => Promise.resolve(),
    beforeEffect: () => {
      /* Explicit fixture authority. */
    },
  };
  return {
    roots,
    input,
    files,
    authority,
    options,
    bytes,
    partial: path.join(roots.control, `staging/${input.operationId}.partial`),
    staged: path.join(roots.control, `staging/${input.operationId}`),
    journal: path.join(roots.control, `journal/${input.operationId}.json`),
  };
}

it("prepares only an owned partial, then commits exact original staged manifest bytes", async () => {
  const f = await fixture();
  const prepared = await f.files.prepareImport(f.input);
  expect(await readFile(f.partial, "utf8")).toBe(f.bytes);
  await expect(access(f.staged)).rejects.toMatchObject({ code: "ENOENT" });
  const raw = await readFile(f.journal, "utf8");
  expect(JSON.parse(raw)).toMatchObject({ phase: "prepared" });
  await f.files.commitPreparedImport(prepared, f.authority);
  expect(await readFile(f.staged, "utf8")).toBe(f.bytes);
  const accepted = ManifestSchema.parse(JSON.parse(raw));
  accepted.phase = "staged";
  expect(await readFile(f.journal, "utf8")).toBe(JSON.stringify(accepted));
  await expect(
    access(path.join(f.roots.library, f.input.libraryPath)),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const retry = await f.files.prepareImport(f.input);
  await f.files.commitPreparedImport(retry, f.authority);
  expect(await readFile(f.journal, "utf8")).toBe(JSON.stringify(accepted));
});

it("a cold invocation reuses the exact acknowledged complete partial without replacing its inode", async () => {
  const f = await fixture();
  await f.files.prepareImport(f.input);
  const before = await lstat(f.partial, { bigint: true });
  const raw = await readFile(f.journal, "utf8");
  expect(JSON.parse(raw)).toMatchObject({
    preparedPartial: {
      schemaVersion: 1,
      sizeBytes: String(Buffer.byteLength(f.bytes)),
      identity: { inode: before.ino.toString() },
    },
  });
  const cold = new FileOperations(f.roots, f.options);
  const prepared = await cold.prepareImport(f.input);
  expect(await readFile(f.journal, "utf8")).toBe(raw);
  await cold.commitPreparedImport(prepared, f.authority);
  const after = await lstat(f.staged, { bigint: true });
  expect({ inode: after.ino, device: after.dev }).toEqual({
    inode: before.ino,
    device: before.dev,
  });
  expect(await readFile(f.staged, "utf8")).toBe(f.bytes);
});

it.each(["torn", "changed source"])(
  "cold recovery preserves an acknowledged partial when %s bytes fail fresh verification",
  async (kind) => {
    const f = await fixture();
    await f.files.prepareImport(f.input);
    const raw = await readFile(f.journal, "utf8");
    const before = await lstat(f.partial, { bigint: true });
    if (kind === "torn") await writeFile(f.partial, "Incomplete");
    else await writeFile(path.join(f.roots.downloads, "video.mkv"), "Changed");
    const retained = await readFile(f.partial, "utf8");
    await expect(
      new FileOperations(f.roots, f.options).prepareImport(f.input),
    ).rejects.toBeInstanceOf(FileOperationConflict);
    const after = await lstat(f.partial, { bigint: true });
    expect(after.ino).toBe(before.ino);
    expect(await readFile(f.partial, "utf8")).toBe(retained);
    expect(await readFile(f.journal, "utf8")).toBe(raw);
    await expect(access(f.staged)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("expiry before the completed-copy acknowledgment leaves an unproven partial protected from cold adoption", async () => {
  const f = await fixture();
  let copyStarted = false;
  let copied = false;
  const files = new FileOperations(f.roots, {
    ...f.options,
    checkpoint: (phase) => {
      if (phase === "copying") copyStarted = true;
      if (phase === "hashing" && copyStarted) copied = true;
      return Promise.resolve();
    },
    beforeEffect: () => {
      if (copied) throw new Error("Expired before copy acknowledgment");
    },
  });
  await expect(files.prepareImport(f.input)).rejects.toThrow(
    "Expired before copy acknowledgment",
  );
  expect(copied).toBe(true);
  const before = await lstat(f.partial, { bigint: true });
  const raw = await readFile(f.journal, "utf8");
  expect(JSON.parse(raw)).not.toHaveProperty("preparedPartial");
  await expect(
    new FileOperations(f.roots, f.options).prepareImport(f.input),
  ).rejects.toThrow("Unproven import partial requires recovery");
  const after = await lstat(f.partial, { bigint: true });
  expect(after.ino).toBe(before.ino);
  expect(await readFile(f.partial, "utf8")).toBe(f.bytes);
  expect(await readFile(f.journal, "utf8")).toBe(raw);
});

it.each(["path swap", "same-inode rewrite"])(
  "fresh copying rejects a same-byte source %s without acknowledging the partial",
  async (kind) => {
    const f = await fixture();
    const source = path.join(f.roots.downloads, f.input.downloadPath);
    let changed = false;
    const files = new FileOperations(f.roots, {
      ...f.options,
      checkpoint: async (phase) => {
        if (phase !== "copying" || changed) return;
        changed = true;
        if (kind === "path swap") {
          const replacement = `${source}.foreign`;
          await writeFile(replacement, f.bytes);
          await rename(replacement, source);
        } else await writeFile(source, f.bytes);
      },
    });
    await expect(files.prepareImport(f.input)).rejects.toBeInstanceOf(
      FileOperationConflict,
    );
    expect(changed).toBe(true);
    expect(JSON.parse(await readFile(f.journal, "utf8"))).not.toHaveProperty(
      "preparedPartial",
    );
    await expect(access(f.staged)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      access(path.join(f.roots.library, f.input.libraryPath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each(["target swap", "source parent swap", "source same-byte rewrite"])(
  "%s after copying cannot gain the first partial acknowledgment",
  async (kind) => {
    const f = await fixture();
    const source = path.join(f.roots.downloads, f.input.downloadPath);
    let foreignInode: bigint | undefined;
    let changed = false;
    observation.beforeCapture = async (filename) => {
      if (!changed && filename === f.partial) {
        changed = true;
        if (kind === "target swap") {
          const replacement = `${f.partial}.foreign`;
          await writeFile(replacement, f.bytes);
          await rename(replacement, f.partial);
          const foreign = await lstat(f.partial, { bigint: true });
          foreignInode = foreign.ino;
          return;
        }
        if (kind === "source parent swap") {
          await rename(f.roots.downloads, `${f.roots.downloads}.original`);
          await mkdir(f.roots.downloads);
        }
        await writeFile(source, f.bytes);
      }
    };
    await expect(f.files.prepareImport(f.input)).rejects.toThrow(
      kind === "target swap"
        ? "Media file identity changed during verification"
        : FileOperationConflict,
    );
    expect(changed).toBe(true);
    if (kind === "target swap") {
      const after = await lstat(f.partial, { bigint: true });
      expect(after.ino).toBe(foreignInode);
    }
    expect(await readFile(f.partial, "utf8")).toBe(f.bytes);
    expect(JSON.parse(await readFile(f.journal, "utf8"))).not.toHaveProperty(
      "preparedPartial",
    );
    await expect(access(f.staged)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each(["corrupt", "truncated"])(
  "fresh copying rejects %s source bytes without acknowledging the copy",
  async (kind) => {
    const f = await fixture();
    const bytes =
      kind === "corrupt" ? "x".repeat(f.bytes.length) : f.bytes.slice(0, -1);
    await writeFile(path.join(f.roots.downloads, f.input.downloadPath), bytes);
    await expect(f.files.prepareImport(f.input)).rejects.toThrow(
      "Copy source checksum changed",
    );
    expect(JSON.parse(await readFile(f.journal, "utf8"))).not.toHaveProperty(
      "preparedPartial",
    );
    await expect(access(f.staged)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("cancellation while copying leaves the exclusive partial unacknowledged and cold protected", async () => {
  const f = await fixture();
  const bytes = f.bytes.repeat(Math.ceil((2 * 1024 * 1024) / f.bytes.length));
  await writeFile(path.join(f.roots.downloads, f.input.downloadPath), bytes);
  const input = {
    ...f.input,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const cancellation = new Error("Actual copy cancellation");
  let checkpoints = 0;
  const files = new FileOperations(f.roots, {
    ...f.options,
    checkpoint: (phase) =>
      phase === "copying" && ++checkpoints === 2
        ? Promise.reject(cancellation)
        : Promise.resolve(),
  });
  await expect(files.prepareImport(input)).rejects.toBe(cancellation);
  const partial = await readFile(f.partial);
  expect(partial.byteLength).toBe(1024 * 1024);
  expect(
    partial.equals(Buffer.from(bytes).subarray(0, partial.byteLength)),
  ).toBe(true);
  expect(JSON.parse(await readFile(f.journal, "utf8"))).not.toHaveProperty(
    "preparedPartial",
  );
  await expect(
    new FileOperations(f.roots, f.options).prepareImport(input),
  ).rejects.toThrow("Unproven import partial requires recovery");
  await expect(access(f.staged)).rejects.toMatchObject({ code: "ENOENT" });
});

it("an existing supplied ContentProof cannot gain unmeasured staging-path authority from the new-copy optimization", async () => {
  const f = await fixture();
  const contentProof = new ContentProof();
  await contentProof.capture(
    path.join(f.roots.downloads, f.input.downloadPath),
    () => Promise.resolve(),
  );
  contentProof.seal();
  await expect(
    new FileOperations(f.roots, { ...f.options, contentProof }).prepareImport(
      f.input,
    ),
  ).rejects.toBeInstanceOf(FileOperationConflict);
  expect(JSON.parse(await readFile(f.journal, "utf8"))).not.toHaveProperty(
    "preparedPartial",
  );
  await expect(access(f.staged)).rejects.toMatchObject({ code: "ENOENT" });
});

it("a same-byte journal swap during copying cannot be overwritten by the completed-copy acknowledgment", async () => {
  const f = await fixture();
  let swapped = false;
  let foreign = "";
  let foreignInode = 0n;
  const files = new FileOperations(f.roots, {
    ...f.options,
    checkpoint: async (phase) => {
      if (phase !== "copying" || swapped) return;
      swapped = true;
      foreign = await readFile(f.journal, "utf8");
      const replacement = `${f.journal}.foreign`;
      await writeFile(replacement, foreign);
      await rename(replacement, f.journal);
      const foreignInfo = await lstat(f.journal, { bigint: true });
      foreignInode = foreignInfo.ino;
    },
  });
  await expect(files.prepareImport(f.input)).rejects.toBeInstanceOf(
    FileOperationConflict,
  );
  expect(swapped).toBe(true);
  const after = await lstat(f.journal, { bigint: true });
  expect(after.ino).toBe(foreignInode);
  expect(await readFile(f.journal, "utf8")).toBe(foreign);
  expect(JSON.parse(foreign)).not.toHaveProperty("preparedPartial");
  expect(await readFile(f.partial, "utf8")).toBe(f.bytes);
  await expect(access(f.staged)).rejects.toMatchObject({ code: "ENOENT" });
});

it("cold recovery rejects same-inode same-byte writes that changed the acknowledged timestamps", async () => {
  const f = await fixture();
  await f.files.prepareImport(f.input);
  const before = await lstat(f.partial, { bigint: true });
  const raw = await readFile(f.journal, "utf8");
  await writeFile(f.partial, f.bytes);
  const after = await lstat(f.partial, { bigint: true });
  expect(after.ino).toBe(before.ino);
  await expect(
    new FileOperations(f.roots, f.options).prepareImport(f.input),
  ).rejects.toThrow("Prepared import partial identity changed");
  expect(await readFile(f.partial, "utf8")).toBe(f.bytes);
  expect(await readFile(f.journal, "utf8")).toBe(raw);
  await expect(access(f.staged)).rejects.toMatchObject({ code: "ENOENT" });
});

it("journal validation awaits before the final synchronous authority guard and cannot install after expiry", async () => {
  const f = await fixture();
  await f.files.prepareImport(f.input);
  const raw = await readFile(f.journal, "utf8");
  const manifest = ManifestSchema.parse(JSON.parse(raw));
  const order: string[] = [];
  let expired = false;
  await expect(
    saveManifest(
      f.journal,
      { ...manifest, phase: "staged" },
      {
        validateBeforeInstall: async () => {
          order.push("validation");
          await Promise.resolve();
          expired = true;
        },
        beforeInstall: () => {
          order.push("guard");
          if (expired) throw new Error("Authority expired during validation");
        },
      },
    ),
  ).rejects.toThrow("Authority expired during validation");
  expect(order).toEqual(["validation", "guard"]);
  expect(await readFile(f.journal, "utf8")).toBe(raw);
  expect(await readFile(f.partial, "utf8")).toBe(f.bytes);
  await expect(access(f.staged)).rejects.toMatchObject({ code: "ENOENT" });
});

it("a journal acknowledgment preserves both the base and supplied synchronous installation guards", async () => {
  const f = await fixture();
  await f.files.prepareImport(f.input);
  const raw = await readFile(f.journal, "utf8");
  const order: string[] = [];
  const journal = new OperationJournal(
    (relative) => Promise.resolve(path.join(f.roots.control, relative)),
    undefined,
    () => {
      order.push("base");
    },
  );
  await expect(
    journal.save(ManifestSchema.parse(JSON.parse(raw)), {
      beforeInstall: () => {
        order.push("caller");
        throw new Error("Caller denied acknowledgment");
      },
    }),
  ).rejects.toThrow("Caller denied acknowledgment");
  expect(order).toEqual(["base", "caller"]);
  expect(await readFile(f.journal, "utf8")).toBe(raw);
});

it.each(["partial", "journal"] as const)(
  "refuses same-byte substituted %s before accepting staging",
  async (field) => {
    const f = await fixture();
    const prepared = await f.files.prepareImport(f.input);
    const replacement = `${f[field]}.foreign`;
    await writeFile(replacement, await readFile(f[field]));
    await rename(replacement, f[field]);
    await expect(
      f.files.commitPreparedImport(prepared, f.authority),
    ).rejects.toBeInstanceOf(FileOperationConflict);
    await expect(access(f.staged)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(f.journal, "utf8"))).toMatchObject({
      phase: "prepared",
    });
  },
);

it("refuses revoked final authority without adopting partial bytes and rejects foreign capabilities", async () => {
  const f = await fixture();
  const prepared = await f.files.prepareImport(f.input);
  const denied = new Error("Choice revoked");
  await expect(
    f.files.commitPreparedImport(prepared, {
      ...f.authority,
      authorize: () => Promise.reject(denied),
    }),
  ).rejects.toBe(denied);
  await expect(
    new FileOperations(f.roots, f.options).commitPreparedImport(
      prepared,
      f.authority,
    ),
  ).rejects.toBeInstanceOf(FileOperationConflict);
  await expect(
    f.files.commitPreparedImport(
      { operationId: prepared.operationId },
      f.authority,
    ),
  ).rejects.toBeInstanceOf(FileOperationConflict);
  expect(await readFile(f.partial, "utf8")).toBe(f.bytes);
  await expect(access(f.staged)).rejects.toMatchObject({ code: "ENOENT" });
});
