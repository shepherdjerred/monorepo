import {
  mkdir,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  contentSHA,
  decodeBlob,
  encodeBlob,
  maximumFileBytes,
  RelativePathSchema,
} from "./fields.ts";
import {
  readFiles,
  referenceApply,
  snapshot,
  type GuestPaths,
} from "./owned-files.ts";
import { guestDirectories } from "./fixtures.test-support.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});
async function fixture(): Promise<GuestPaths> {
  const { paths } = await guestDirectories(roots, "facet-guest-files-");
  await mkdir(path.join(paths.referenceDirectory, "Tasks"));
  await writeFile(
    path.join(paths.referenceDirectory, "Tasks/Existing.md"),
    "original synthetic bytes",
  );
  await mkdir(
    path.join(paths.referenceDirectory, ".obsidian/plugins/tasknotes"),
    { recursive: true },
  );
  await writeFile(
    path.join(
      paths.referenceDirectory,
      ".obsidian/plugins/tasknotes/data.json",
    ),
    "{}",
  );
  await writeFile(
    path.join(paths.referenceDirectory, ".obsidian/private.json"),
    "must never leave guest",
  );
  return paths;
}

test("inventory reports every synthetic file and only the supported Obsidian settings", async () => {
  const paths = await fixture();
  await writeFile(
    path.join(paths.referenceDirectory, "Unexpected.md"),
    "unexpected",
  );
  const inventory = await snapshot(paths.referenceDirectory);
  expect(Object.keys(inventory)).toEqual([
    ".obsidian/plugins/tasknotes/data.json",
    "Tasks/Existing.md",
    "Unexpected.md",
  ]);
  expect(inventory["Tasks/Existing.md"]).toEqual({
    size: 24,
    sha256: contentSHA("original synthetic bytes"),
  });
  const files = await readFiles(paths.referenceDirectory, [
    "Tasks/Existing.md",
  ]);
  expect(new TextDecoder().decode(decodeBlob(files["Tasks/Existing.md"]))).toBe(
    "original synthetic bytes",
  );
  await expect(
    readFiles(paths.referenceDirectory, [".obsidian/private.json"]),
  ).rejects.toThrow();
});

test("path traversal, foreign symlinks and oversized regular files are rejected", async () => {
  const paths = await fixture();
  for (const name of [
    "../outside",
    "/absolute",
    "Tasks//note",
    "Tasks/constructor/file",
    String.raw`Tasks\escape`,
  ])
    expect(() => RelativePathSchema.parse(name)).toThrow();
  await symlink(
    path.join(paths.referenceDirectory, "Tasks/Existing.md"),
    path.join(paths.referenceDirectory, "Tasks/Linked.md"),
  );
  await expect(
    readFiles(paths.referenceDirectory, ["Tasks/Linked.md"]),
  ).rejects.toThrow();
  await expect(snapshot(paths.referenceDirectory)).rejects.toThrow();
  const large = path.join(paths.referenceDirectory, "Tasks/Large.md");
  await writeFile(large, "");
  await truncate(large, maximumFileBytes + 1);
  await expect(
    readFiles(paths.referenceDirectory, ["Tasks/Large.md"]),
  ).rejects.toThrow();
});

test("writes, rename and deletion require exact preimages and retain displaced bytes", async () => {
  const paths = await fixture(),
    name = "Tasks/Existing.md",
    id = crypto.randomUUID();
  await referenceApply(
    paths,
    {
      kind: "write",
      path: name,
      expectedSHA256: contentSHA("original synthetic bytes"),
      blob: encodeBlob(new TextEncoder().encode("changed")),
    },
    id,
  );
  const recovery = JSON.parse(
    await readFile(
      path.join(paths.evidenceDirectory, `transport-recovery/${id}.json`),
      "utf8",
    ),
  );
  expect(new TextDecoder().decode(decodeBlob(recovery.prior))).toBe(
    "original synthetic bytes",
  );
  await expect(
    referenceApply(
      paths,
      { kind: "delete", path: name, expectedSHA256: contentSHA("stale") },
      crypto.randomUUID(),
    ),
  ).rejects.toThrow("preimage");
  await referenceApply(
    paths,
    {
      kind: "rename",
      path: name,
      destination: "Tasks/Renamed.md",
      expectedSHA256: contentSHA("changed"),
    },
    crypto.randomUUID(),
  );
  await referenceApply(
    paths,
    {
      kind: "delete",
      path: "Tasks/Renamed.md",
      expectedSHA256: contentSHA("changed"),
    },
    crypto.randomUUID(),
  );
  await referenceApply(
    paths,
    {
      kind: "write",
      path: "Attachments/zero.bin",
      expectedSHA256: null,
      blob: encodeBlob(new Uint8Array()),
    },
    crypto.randomUUID(),
  );
  const inventory = await snapshot(paths.referenceDirectory);
  expect(inventory["Attachments/zero.bin"]?.size).toBe(0);
});

test("unknown destinations and settings outside the TaskNotes fixture stay untouched", async () => {
  const paths = await fixture();
  await writeFile(path.join(paths.referenceDirectory, "Tasks/Peer.md"), "peer");
  await expect(
    referenceApply(
      paths,
      {
        kind: "rename",
        path: "Tasks/Existing.md",
        destination: "Tasks/Peer.md",
        expectedSHA256: contentSHA("original synthetic bytes"),
      },
      crypto.randomUUID(),
    ),
  ).rejects.toThrow();
  expect(
    await readFile(
      path.join(paths.referenceDirectory, "Tasks/Peer.md"),
      "utf8",
    ),
  ).toBe("peer");
  await expect(
    referenceApply(
      paths,
      {
        kind: "write",
        path: ".obsidian/private.json",
        expectedSHA256: null,
        blob: encodeBlob(new Uint8Array()),
      },
      crypto.randomUUID(),
    ),
  ).rejects.toThrow();
  expect(
    await readFile(
      path.join(paths.referenceDirectory, ".obsidian/private.json"),
      "utf8",
    ),
  ).toBe("must never leave guest");
});

test("evidence export admits only scoped summaries and actual PNG attachment paths", async () => {
  const paths = await fixture(),
    relative =
      "journeys/round-1/capture-macos-1/attachments/12345678-1234-1234-1234-123456789abc.png";
  await mkdir(path.dirname(path.join(paths.evidenceDirectory, relative)), {
    recursive: true,
  });
  await writeFile(path.join(paths.evidenceDirectory, relative), "PNG fixture");
  await writeFile(
    path.join(paths.evidenceDirectory, "account.json"),
    "private account",
  );
  const raw = path.join(
    paths.evidenceDirectory,
    "journeys/round-1/capture-macos-1/Journey.xcresult",
  );
  await mkdir(raw);
  await symlink(paths.stateDirectory, path.join(raw, "must-not-traverse"));
  expect(Object.keys(await snapshot(paths.evidenceDirectory, true))).toEqual([
    relative,
  ]);
  await expect(
    readFiles(paths.evidenceDirectory, ["account.json"], true),
  ).rejects.toThrow();
});

test("binary wire values reject altered hashes, sizes and noncanonical base64", () => {
  const blob = encodeBlob(new Uint8Array([0, 255, 127]));
  expect([...decodeBlob(blob)]).toEqual([0, 255, 127]);
  for (const altered of [
    { ...blob, size: 2 },
    { ...blob, sha256: "a".repeat(64) },
    { ...blob, base64: blob.base64 + "=" },
  ])
    expect(() => decodeBlob(altered)).toThrow();
});
