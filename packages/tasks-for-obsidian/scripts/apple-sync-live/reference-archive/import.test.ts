import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rmdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { digest } from "../model";
import { parseExecutionArguments } from "../prepare";
import { ArchiveSchema, archivePaths, assertArchiveBinding } from "./contract";
import { importReferenceArchive, readReferenceArchive } from "./import";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const sourceRun = "5cab68a9-49f9-4252-9c6c-5d9d2dfb4415";
const remote = "1ca47bf285e0a7144d38e22041e2af7e";
const hash = "a".repeat(64);
const sourcePaths = [
  "client.ts",
  "host.ts",
  "fields.ts",
  "contract.ts",
  "execution/bootstrap-code.ts",
];

async function fixture(settings?: unknown) {
  const settingsData =
    settings === undefined
      ? {
          enableAPI: false,
          enableMCP: false,
          ordinarySetting: { unknownPreserved: 7 },
        }
      : settings;
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "facet-reference-archive-test-")),
  );
  roots.push(root);
  const directory = path.join(root, "archive");
  await mkdir(directory, { mode: 0o700 });
  const reference: Record<string, { size: number; sha256: string }> = {};
  for (const relative of archivePaths) {
    const bytes = Buffer.from(
      relative.endsWith("data.json")
        ? JSON.stringify(settingsData)
        : relative.endsWith("empty.bin")
          ? ""
          : relative,
    );
    const filename = path.join(directory, "files", relative);
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    await writeFile(filename, bytes, { mode: 0o600, flag: "wx" });
    reference[relative] = { size: bytes.length, sha256: digest(bytes) };
  }
  const source = ArchiveSchema.parse({
    schemaVersion: 1,
    kind: "facet-reference-data-archive",
    sourceRunID: sourceRun,
    sourceHead: "4".repeat(40),
    remoteVaultID: remote,
    sealSHA256: hash,
    sourceManifestSHA256: hash,
    reference,
    credentialAbsence: {
      schemaVersion: 1,
      sourceRunID: sourceRun,
      checkedAt: "2026-10-28T10:00:00.000Z",
      flagsOff: true,
      credentialStringsAbsentEmpty: true,
      webhookICSCalendarArraysAbsentEmpty: true,
      integrationTokenStoresAbsentEmpty: true,
      nestedExportsOff: true,
      savedSafe: true,
      valuesExported: false,
    },
    readerPins: {
      "live-guest.js": hash,
      "live-config.json": hash,
      "artifact.json": hash,
      "payload.json": hash,
    },
    readerSourcePins: Object.fromEntries(
      sourcePaths.map((entry) => [
        `packages/tasks-for-obsidian/scripts/apple-sync-live/transport/${entry}`,
        hash,
      ]),
    ),
    signature: {
      kind: "adhoc",
      identifier: "red.sjer.tasknotes.mac.acceptance",
      teamIdentifier: null,
      verified: true,
      appFileCount: 41,
      projectSourceSHA256: hash,
      artifactVerifierSourceSHA256: hash,
    },
    historicalDataOnly: true,
    credentialProofReusable: false,
    createdAt: "2026-10-28T10:01:00.000Z",
  });
  const raw = Buffer.from(JSON.stringify(source));
  await writeFile(path.join(directory, "archive.json"), raw, {
    flag: "wx",
    mode: 0o600,
  });
  return { root, directory, sha256: digest(raw), source };
}

test("fresh import copies only five exact data files, preserves unknown settings bytes and keeps explicit historical lineage", async () => {
  const input = await fixture();
  const target = path.join(input.root, "fresh-reference");
  const result = await importReferenceArchive(input, target);
  expect(result.referenceArchive).toEqual({
    archiveSHA256: input.sha256,
    source: input.source,
  });
  expect(result.reference).toEqual(input.source.reference);
  expect(Object.keys(result).sort()).toEqual(["reference", "referenceArchive"]);
  for (const relative of archivePaths) {
    expect(await readFile(path.join(target, relative))).toEqual(
      await readFile(path.join(input.directory, "files", relative)),
    );
    const metadata = await lstat(path.join(target, relative));
    expect(metadata.mode & 0o777).toBe(0o600);
  }
  await expect(importReferenceArchive(input, target)).rejects.toThrow();
});

test("archive rejects wrong manifest hash, byte changes, unexpected files and unexpected empty directories", async () => {
  const input = await fixture();
  await expect(
    readReferenceArchive({ ...input, sha256: "b".repeat(64) }),
  ).rejects.toThrow("manifest hash");
  const file = path.join(input.directory, "files", "Reference.md");
  const original = await readFile(file);
  await writeFile(file, "changed");
  await expect(readReferenceArchive(input)).rejects.toThrow("sealed lineage");
  await writeFile(file, original);
  await mkdir(path.join(input.directory, "unexpected"), { mode: 0o700 });
  await expect(readReferenceArchive(input)).rejects.toThrow("unexpected entry");
  await rmdir(path.join(input.directory, "unexpected"));
  await writeFile(path.join(input.directory, "token.json"), "synthetic", {
    mode: 0o600,
  });
  await expect(readReferenceArchive(input)).rejects.toThrow("unexpected entry");
});

test("archive refuses linked roots, linked files and nonprivate modes", async () => {
  const input = await fixture();
  const alias = path.join(input.root, "alias");
  await symlink(input.directory, alias);
  await expect(
    readReferenceArchive({ ...input, directory: alias }),
  ).rejects.toThrow("real directory");
  const file = path.join(input.directory, "files", "Reference.md");
  await chmod(file, 0o644);
  await expect(readReferenceArchive(input)).rejects.toThrow("non-private");
  await chmod(file, 0o600);
  await rm(file);
  await symlink(path.join(input.directory, "files", "Tasks/Existing.md"), file);
  await expect(readReferenceArchive(input)).rejects.toThrow("linked");
});

test.each([
  { enableAPI: true },
  { enableMCP: "false" },
  { apiAuthToken: "synthetic-not-a-secret" },
  { webhooks: [{ secret: "synthetic" }] },
  { icsSubscriptions: ["synthetic"] },
  { googleCalendarSyncTokens: { synthetic: "synthetic" } },
  { oauthConnections: null },
  { enabledGoogleCalendars: ["synthetic"] },
  { googleCalendarExport: { enabled: true } },
  { icsIntegration: { enableAutoExport: true } },
])(
  "archive rechecks settings bytes instead of trusting true absence attestations (%j)",
  async (settings) => {
    const input = await fixture(settings);
    await expect(
      importReferenceArchive(input, path.join(input.root, "fresh-reference")),
    ).rejects.toThrow("credential-bearing settings");
    await expect(
      lstat(path.join(input.root, "fresh-reference")),
    ).rejects.toThrow();
  },
);

test("lineage binds only the existing remote and refuses omitted or changed provenance", async () => {
  const input = await fixture();
  const { referenceArchive: lineage } = await readReferenceArchive(input);
  expect(() => assertArchiveBinding(lineage, lineage, remote)).not.toThrow();
  expect(() => assertArchiveBinding(lineage, lineage, "f".repeat(32))).toThrow(
    "existing synthetic",
  );
  expect(() => assertArchiveBinding(lineage, undefined, remote)).toThrow(
    "lineage differs",
  );
  expect(() => assertArchiveBinding(undefined, lineage, remote)).toThrow(
    "lineage differs",
  );
  expect(() =>
    assertArchiveBinding(
      lineage,
      { ...lineage, archiveSHA256: "c".repeat(64) },
      remote,
    ),
  ).toThrow("lineage differs");
});

test("prepare archive flags are paired, SHA pinned and guest-only", () => {
  const base = [
    "--vm",
    "facet-test",
    "--official-export",
    sourceRun,
    "--official-sha256",
    hash,
  ];
  const flags = [
    "--reference-archive",
    "/private/tmp/archive",
    "--reference-archive-sha256",
    hash,
  ];
  expect(parseExecutionArguments([...base, ...flags]).referenceArchive).toEqual(
    { directory: "/private/tmp/archive", sha256: hash },
  );
  expect(() =>
    parseExecutionArguments([
      ...base,
      "--reference-archive",
      "/private/tmp/archive",
    ]),
  ).toThrow("together");
  expect(() => parseExecutionArguments(["--host-ui", ...flags])).toThrow(
    "headless guest",
  );
  expect(() =>
    parseExecutionArguments([...base, ...flags, ...flags]),
  ).toThrow();
});
