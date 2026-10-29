import { afterEach, expect, it, vi } from "vitest";
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
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { ContentProof } from "#filesystem/content-proof.ts";
import type * as FsPromises from "node:fs/promises";

const observation = vi.hoisted(
  (): { afterStat: ((filename: string) => void) | null } => ({
    afterStat: null,
  }),
);
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      try {
        return await actual.lstat(...args);
      } finally {
        observation.afterStat?.(String(args[0]));
      }
    },
  };
});

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  observation.afterStat = null;
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
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
  expect(await readFile(f.journal, "utf8")).toBe(
    raw.replace('"phase":"prepared"', '"phase":"staged"'),
  );
  await expect(
    access(path.join(f.roots.library, f.input.libraryPath)),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const retry = await f.files.prepareImport(f.input);
  await f.files.commitPreparedImport(retry, f.authority);
  expect(await readFile(f.journal, "utf8")).toBe(
    raw.replace('"phase":"prepared"', '"phase":"staged"'),
  );
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
