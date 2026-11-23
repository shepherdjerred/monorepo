import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { createStaticArchive } from "@shepherdjerred/root-scripts/lib/static-site-archive.ts";
import { prepareReplayPublication } from "./package.ts";

const temporaryRoots: string[] = [];
const engine =
  'throw new Error("The archive verifier must never execute this file");\n';
const resource = "synthetic Scout drawing input\n";
const sha256 = (text: string) =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex");
const manifest = {
  schemaVersion: 1,
  gameBuild: "16.23.840.6595",
  protocol: "a".repeat(16),
  entrypoint: "runtime/index.js",
  capabilities: {
    mapId: 11,
    gameMode: "CLASSIC",
    teamSizes: [5, 5],
    rosterCoverage: "all-legal-lineups-and-skins",
    rosterInventorySha256: "a".repeat(64),
  },
  files: [
    { path: "runtime/index.js", bytes: engine.length, sha256: sha256(engine) },
    {
      path: "resources/data.txt",
      bytes: resource.length,
      sha256: sha256(resource),
    },
  ],
};

afterEach(async () => {
  for (const root of temporaryRoots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function archive(
  options: {
    manifestText?: string | null;
    engineText?: string;
    enginePath?: string;
    includeResource?: boolean;
    extra?: boolean;
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "scout-replay-publish-"));
  temporaryRoots.push(root);
  const source = path.join(root, "source");
  const directory = path.join(root, "restore");
  const archivePath = path.join(root, "package.tar");
  await mkdir(path.join(source, "runtime"), { recursive: true });
  await mkdir(path.join(source, "resources"));
  await mkdir(directory);
  const enginePath = options.enginePath ?? manifest.entrypoint;
  const members = [enginePath];
  await Bun.write(path.join(source, enginePath), options.engineText ?? engine);
  if (options.includeResource !== false) {
    members.push("resources/data.txt");
    await Bun.write(path.join(source, "resources", "data.txt"), resource);
  }
  if (options.manifestText !== null) {
    members.push("manifest.json");
    await Bun.write(
      path.join(source, "manifest.json"),
      options.manifestText ?? JSON.stringify(manifest),
    );
  }
  if (options.extra === true) {
    members.push("extra.txt");
    await Bun.write(path.join(source, "extra.txt"), "unlisted");
  }
  const { digest: archiveDigest } = await createStaticArchive(
    source,
    archivePath,
    members,
  );
  return { directory, archivePath, archiveDigest };
}

test("verifies every file and schedules the original manifest last", async () => {
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const prepared = await prepareReplayPublication(
    await archive({ manifestText }),
  );
  expect(prepared).toMatchObject({
    gameBuild: manifest.gameBuild,
    protocol: manifest.protocol,
    manifestSha256: sha256(manifestText),
  });
  const key = `replay-assets/${manifest.gameBuild}/${prepared.manifestSha256}`;
  expect(prepared.objects.map((object) => object.key)).toEqual([
    `${key}/runtime/index.js`,
    `${key}/resources/data.txt`,
    `${key}/manifest.json`,
  ]);
  for (const [index, object] of prepared.objects.entries()) {
    expect(path.isAbsolute(object.path)).toBe(true);
    const text = await Bun.file(object.path).text();
    expect(text).toBe([engine, resource, manifestText][index]);
    expect(object.bytes).toBe(Buffer.byteLength(text));
    expect(object.sha256).toBe(sha256(text));
  }
  expect(prepared.objects[0]?.contentType).toMatch(/^text\/javascript/);
  expect(prepared.objects.at(-1)).toMatchObject({
    bytes: manifestText.length,
    sha256: sha256(manifestText),
    contentType: "application/json",
  });
});

test.each([
  [{ manifestText: null }, "no root manifest.json"],
  [{ includeResource: false }, "exact manifest inventory"],
  [{ includeResource: false, extra: true }, "exact manifest inventory"],
  [{ extra: true }, "exact manifest inventory"],
  [{ engineText: `${engine}extra` }, "length differs"],
  [{ engineText: engine.replace("verifier", "compiler") }, "bytes differ"],
  [
    {
      manifestText: JSON.stringify({
        ...manifest,
        gameBuild: "16.23.840.06595",
      }),
    },
    "canonical game build",
  ],
  [
    {
      manifestText: JSON.stringify({
        ...manifest,
        files: [...manifest.files, manifest.files[0]],
      }),
    },
    "inventory must be unique",
  ],
])("rejects an invalid replay archive (%j)", async (options, message) => {
  await expect(
    prepareReplayPublication(await archive(options)),
  ).rejects.toThrow(message);
});

test("checks the selected archive digest before accepting its contents", async () => {
  const input = await archive();
  await expect(
    prepareReplayPublication({
      ...input,
      archiveDigest: `sha256:${"0".repeat(64)}`,
    }),
  ).rejects.toThrow("checksum differs");
});

test("limits the manifest before parsing it", async () => {
  const manifestText = " ".repeat(16 * 1024 * 1024 + 1);
  await expect(
    prepareReplayPublication(await archive({ manifestText })),
  ).rejects.toThrow("exceeds 16 MiB");
});

test("rejects a UTF-8 BOM before accepting a manifest", async () => {
  const manifestText = `\u{FEFF}${JSON.stringify(manifest)}`;
  await expect(
    prepareReplayPublication(await archive({ manifestText })),
  ).rejects.toThrow(SyntaxError);
});

test("rejects a non-JavaScript entrypoint even when its bytes match", async () => {
  const enginePath = "runtime/index.txt";
  const manifestText = JSON.stringify({
    ...manifest,
    entrypoint: enginePath,
    files: manifest.files.map((file) =>
      file.path === manifest.entrypoint ? { ...file, path: enginePath } : file,
    ),
  });
  await expect(
    prepareReplayPublication(await archive({ manifestText, enginePath })),
  ).rejects.toThrow("entrypoint must be a JavaScript module");
});
