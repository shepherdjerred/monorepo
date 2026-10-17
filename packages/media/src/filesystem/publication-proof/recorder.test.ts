import { afterEach, expect, test, vi } from "vitest";
import type * as FsPromises from "node:fs/promises";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rm,
  lstat,
  rename,
  readdir,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { FileOperations } from "#filesystem/operations.ts";
import { ContentProof } from "#filesystem/content-proof.ts";
import type { ContentPath } from "#filesystem/operation-locks.ts";
import type {
  LockedPublicationEvent,
  PublicationEffect,
} from "#shared/publication-proof/effects.ts";
import { publicationRecordStore } from "./store.ts";

const observation = vi.hoisted(
  (): { afterClose: ((filename: string) => void) | null } => ({
    afterClose: null,
  }),
);
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        observation.afterClose?.(String(args[0]));
      };
      return handle;
    },
  };
});

const directories: string[] = [];
afterEach(async () => {
  observation.afterClose = null;
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test.each(["beforeEffect", "recorder"] as const)(
  "journal installation composes %s with recorded media effects after final close",
  async (kind) => {
    const f = await fixture();
    const journal = path.join(
      f.roots.control,
      "journal",
      `${f.descriptor.operationId}.json`,
    );
    const original = await readFile(journal, "utf8");
    let expired = false;
    observation.afterClose = (filename) => {
      if (filename === `${journal}.tmp` && f.effects.length === 2)
        expired = true;
    };
    const failure = new Error("Authority expired during journal close");
    const assertActive = () => {
      if (expired) throw failure;
    };
    const files = new FileOperations(f.roots, {
      ...f.options,
      beforeEffect:
        kind === "beforeEffect" ? assertActive : () => f.proof.assertActive(),
      effectRecorder: {
        ...f.options.effectRecorder,
        assertActive:
          kind === "recorder"
            ? assertActive
            : f.options.effectRecorder.assertActive,
      },
    });
    await expect(
      files.withContentPaths(f.paths, () => files.importFile(f.descriptor), [
        f.descriptor.operationId,
      ]),
    ).rejects.toBe(failure);
    expect(expired).toBe(true);
    expect(await readFile(journal, "utf8")).toBe(original);
    expect(
      await readFile(path.join(f.roots.library, "movie.mkv"), "utf8"),
    ).toBe("successor");
    expect(f.effects.map((record) => record.effect.step)).toEqual([
      "import_backup_link",
      "import_publish_rename",
    ]);
  },
);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
async function fixture() {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "media-publication-effects-")),
  );
  directories.push(directory);
  const roots = {
    library: path.join(directory, "library"),
    control: path.join(directory, "control"),
    downloads: path.join(directory, "downloads"),
  };
  for (const root of Object.values(roots)) await mkdir(root);
  await mkdir(path.join(roots.control, "quarantine"));
  await writeFile(path.join(roots.downloads, "next.mkv"), "successor");
  await writeFile(path.join(roots.library, "movie.mkv"), "predecessor");
  await writeFile(path.join(roots.library, "movie.en.srt"), "subtitle");
  const descriptor = {
    operationId: "import-video",
    downloadPath: "next.mkv",
    libraryPath: "movie.mkv",
    sha256: digest("successor"),
    previousSha256: digest("predecessor"),
  };
  await new FileOperations(roots, {
    authorize: () => Promise.resolve(),
    minimumFreeBytes: 0,
  }).importFile({ ...descriptor, stopAfterStaging: true });
  const transitionId = crypto.randomUUID();
  const store = await publicationRecordStore(roots, {
    transitionId,
    continuationId: null,
    assertActive: () => {
      /* synchronous invocation check */
    },
  });
  const paths: ContentPath[] = [
    { root: "library", path: "movie.mkv" },
    { root: "library", path: "movie.en.srt" },
    { root: "control", path: "staging/import-video" },
    { root: "control", path: "rollback/import-video" },
    { root: "control", path: "quarantine/old-subtitle" },
  ];
  const proof = new ContentProof();
  for (const item of paths)
    await proof.capture(path.join(roots[item.root], item.path), () =>
      Promise.resolve(),
    );
  proof.seal();
  const effects: PublicationEffect[] = [];
  const assetId = crypto.randomUUID();
  async function acknowledge(effect: LockedPublicationEvent) {
    const previous = effects.at(-1);
    const record: PublicationEffect = {
      schemaVersion: 1,
      transitionId,
      continuationId: null,
      intentHash: digest("intent"),
      ordinal: effects.length,
      previousEffectHash:
        previous === undefined ? null : digest(JSON.stringify(previous)),
      entryOperationId: descriptor.operationId,
      assetId,
      subtitleId: null,
      libraryKind: "movies",
      effect,
    };
    await store.append(record);
    effects.push(record);
  }
  const options = {
    authorize: () => Promise.resolve(),
    contentProof: proof,
    effectRecorder: {
      assertActive: () => {
        /* synchronous invocation check */
      },
      acknowledge,
    },
  };
  const files = new FileOperations(roots, options);
  return {
    directory,
    roots,
    descriptor,
    store,
    paths,
    proof,
    effects,
    options,
    files,
  };
}

test("actual upgrade records locked backup/link and publication/rename with persisted staged journals", async () => {
  const f = await fixture();
  await f.files.withContentPaths(
    f.paths,
    () => f.files.importFile(f.descriptor),
    [f.descriptor.operationId],
  );
  expect(f.effects.map((record) => record.effect.step)).toEqual([
    "import_backup_link",
    "import_publish_rename",
    "journal_complete",
  ]);
  const first = f.effects[0]?.effect;
  const last = f.effects[1]?.effect;
  if (
    first?.primitive === "journal_complete" ||
    last?.primitive === "journal_complete"
  )
    throw new Error("Expected media primitives before completion");
  expect(
    first?.before.find((item) => item.path === "rollback/import-video")?.state,
  ).toBe("absent");
  const archive = await lstat(
    path.join(f.roots.control, "rollback/import-video"),
    { bigint: true },
  );
  expect(
    first?.after
      .filter((item) => item.state === "present")
      .map((item) => item.identity.inode),
  ).toEqual([archive.ino.toString(), archive.ino.toString()]);
  expect(last?.before.map((item) => item.path).sort()).toEqual([
    "movie.mkv",
    "rollback/import-video",
    "staging/import-video",
  ]);
  for (const record of f.effects) {
    expect(JSON.parse(record.effect.journal.raw)).toMatchObject({
      phase:
        record.effect.primitive === "journal_complete" ? "complete" : "staged",
      kind: "import",
    });
    expect(record.effect.journal.sha256).toBe(
      digest(record.effect.journal.raw),
    );
  }
  expect(await f.files.readManifest(f.descriptor.operationId)).toMatchObject({
    phase: "complete",
  });
  const completion = f.effects.at(-1)?.effect;
  if (completion?.primitive !== "journal_complete")
    throw new Error("Missing durable completion");
  expect(completion.beforeJournal).toEqual(last?.journal);
  expect(completion.journal.identity.inode).not.toBe(
    completion.beforeJournal.identity.inode,
  );
  expect(await readFile(path.join(f.roots.library, "movie.mkv"), "utf8")).toBe(
    "successor",
  );
});

test("sidecar link-only acknowledgment exists before unlink and without a video import completion", async () => {
  const f = await fixture();
  await unlink(path.join(f.roots.control, "journal/import-video.json"));
  const files = new FileOperations(f.roots, {
    ...f.options,
    effectRecorder: {
      ...f.options.effectRecorder,
      acknowledge: async (effect) => {
        await f.options.effectRecorder.acknowledge(effect);
        throw new Error("stop after durable sidecar link");
      },
    },
  });
  await expect(
    files.withContentPaths(
      f.paths,
      () =>
        files.quarantine({
          operationId: "move-sidecar",
          libraryPath: "movie.en.srt",
          quarantineId: "old-subtitle",
          sha256: digest("subtitle"),
        }),
      ["move-sidecar"],
    ),
  ).rejects.toThrow("stop after durable");
  expect(f.effects.map((item) => item.effect.step)).toEqual(["move_link"]);
  expect(JSON.parse(f.effects[0]?.effect.journal.raw ?? "null")).toMatchObject({
    kind: "quarantine",
    phase: "prepared",
  });
  const source = await lstat(path.join(f.roots.library, "movie.en.srt"), {
    bigint: true,
  });
  const target = await lstat(
    path.join(f.roots.control, "quarantine/old-subtitle"),
    { bigint: true },
  );
  expect(source.ino).toBe(target.ino);
  expect(await files.readManifest("import-video")).toBeNull();
});

test("durable complete-journal acknowledgment survives failure before caller commit", async () => {
  const f = await fixture();
  const files = new FileOperations(f.roots, {
    ...f.options,
    effectRecorder: {
      ...f.options.effectRecorder,
      acknowledge: async (effect) => {
        await f.options.effectRecorder.acknowledge(effect);
        if (effect.primitive === "journal_complete")
          throw new Error("stop before PG outcome");
      },
    },
  });
  await expect(
    files.withContentPaths(f.paths, () => files.importFile(f.descriptor), [
      f.descriptor.operationId,
    ]),
  ).rejects.toThrow("stop before PG outcome");
  const complete = f.effects.at(-1)?.effect;
  if (complete?.primitive !== "journal_complete")
    throw new Error("Missing actual completion ACK");
  const journalPath = path.join(f.roots.control, complete.journal.path);
  expect(await readFile(journalPath, "utf8")).toBe(complete.journal.raw);
  const installed = await lstat(journalPath, { bigint: true });
  expect(installed.ino.toString()).toBe(complete.journal.identity.inode);
  expect(complete.beforeJournal).toEqual(f.effects.at(-2)?.effect.journal);
  expect(
    complete.participants.find(
      (item) => item.root === "library" && item.path === "movie.mkv",
    ),
  ).toMatchObject({ state: "present", sha256: f.descriptor.sha256 });
});

test("same-byte journal substitution after video ACK cannot acquire completion authority", async () => {
  const f = await fixture();
  const files = new FileOperations(f.roots, {
    ...f.options,
    checkpoint: async (phase) => {
      if (phase !== "published") return;
      const journal = path.join(f.roots.control, "journal/import-video.json");
      const replacement = `${journal}.foreign`;
      await writeFile(replacement, await readFile(journal));
      await rename(replacement, journal);
    },
  });
  await expect(
    files.withContentPaths(f.paths, () => files.importFile(f.descriptor), [
      f.descriptor.operationId,
    ]),
  ).rejects.toThrow("journal was replaced");
  expect(f.effects.map((item) => item.effect.step)).toEqual([
    "import_backup_link",
    "import_publish_rename",
  ]);
  expect(await files.readManifest(f.descriptor.operationId)).toMatchObject({
    phase: "staged",
  });
});

test("recorder refuses an operation without all affected path locks before changing bytes", async () => {
  const f = await fixture();
  await expect(f.files.importFile(f.descriptor)).rejects.toThrow(
    "every affected path lock",
  );
  expect(f.effects).toEqual([]);
  expect(await readFile(path.join(f.roots.library, "movie.mkv"), "utf8")).toBe(
    "predecessor",
  );
});

test("an invocation deadline reached while authorizing cannot acknowledge or mutate", async () => {
  const f = await fixture();
  let expired = false;
  const files = new FileOperations(f.roots, {
    ...f.options,
    authorize: () => {
      expired = true;
      return Promise.resolve();
    },
    effectRecorder: {
      ...f.options.effectRecorder,
      assertActive: () => {
        if (expired) throw new Error("fixture invocation deadline");
      },
    },
  });
  await expect(
    files.withContentPaths(f.paths, () => files.importFile(f.descriptor), [
      f.descriptor.operationId,
    ]),
  ).rejects.toThrow("invocation deadline");
  expect(f.effects).toEqual([]);
  expect(await readFile(path.join(f.roots.library, "movie.mkv"), "utf8")).toBe(
    "predecessor",
  );
  await expect(
    lstat(path.join(f.roots.control, "rollback/import-video")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

test("durable records replay identical bytes and reject a conflicting ordinal without overwriting", async () => {
  const f = await fixture();
  await f.files.withContentPaths(
    f.paths,
    () => f.files.importFile(f.descriptor),
    [f.descriptor.operationId],
  );
  const effect = f.effects[0];
  if (effect === undefined) throw new Error("Actual effect missing");
  const first = await f.store.append(effect);
  const filename = path.join(f.roots.control, first.path);
  const before = await readFile(filename);
  const identity = await lstat(filename, { bigint: true });
  await expect(
    f.store.append({ ...effect, intentHash: digest("other intent") }),
  ).rejects.toThrow("record conflicts");
  expect(await readFile(filename)).toEqual(before);
  const after = await lstat(filename, { bigint: true });
  expect(after.ino).toBe(identity.ino);
});

test("replacement of the record directory protects even when it contains identical records", async () => {
  const f = await fixture();
  await f.files.withContentPaths(
    f.paths,
    () => f.files.importFile(f.descriptor),
    [f.descriptor.operationId],
  );
  const effect = f.effects[0];
  if (effect === undefined) throw new Error("Actual effect missing");
  const record = await f.store.append(effect);
  const directory = path.dirname(path.join(f.roots.control, record.path));
  await rename(directory, `${directory}-original`);
  await mkdir(directory);
  for (const filename of await readdir(`${directory}-original`))
    await writeFile(
      path.join(directory, filename),
      await readFile(path.join(`${directory}-original`, filename)),
    );
  await expect(f.store.append(effect)).rejects.toThrow(
    "directory identity changed",
  );
});
