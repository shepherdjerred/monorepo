import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { assembleReplayPackage } from "./assemble-replay-package.ts";
import { prepareReplayPublication } from "./replay-publication/package.ts";

const temporaryRoots: string[] = [];
const engine = "export const runtimeVersion = 1;\n";
const sha256 = (text: string) =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex");

const manifest = {
  schemaVersion: 1,
  gameBuild: "16.23.840.6595",
  protocol: "8bbfcd5af2bc92db",
  entrypoint: "runtime.js",
  capabilities: {
    mapId: 11,
    gameMode: "CLASSIC",
    teamSizes: [5, 5],
    rosterCoverage: "all-legal-lineups-and-skins",
    rosterInventorySha256: sha256("synthetic inventory"),
  },
  files: [{ path: "runtime.js", sha256: sha256(engine), bytes: engine.length }],
};
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;

afterEach(async () => {
  for (const root of temporaryRoots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function rendererSource() {
  const root = await mkdtemp(path.join(tmpdir(), "scout-replay-assemble-"));
  temporaryRoots.push(root);
  const source = path.join(root, "source");
  await mkdir(source);
  await Bun.write(path.join(source, "runtime.js"), engine);
  await Bun.write(path.join(source, "manifest.json"), manifestText);
  return { root, source, archive: path.join(root, "package.tar") };
}

test("assembles a deterministic archive accepted by the publication verifier", async () => {
  const input = await rendererSource();
  const first = await assembleReplayPackage(input);
  const second = await assembleReplayPackage({
    ...input,
    archive: path.join(input.root, "second.tar"),
  });
  const directory = path.join(input.root, "publisher");
  await mkdir(directory);
  const verification = await prepareReplayPublication({
    archivePath: first.archivePath,
    archiveDigest: first.archiveDigest,
    directory,
  });
  expect(first.archiveDigest).toBe(second.archiveDigest);
  expect(verification).toMatchObject({
    gameBuild: manifest.gameBuild,
    protocol: manifest.protocol,
    manifestSha256: sha256(manifestText),
  });
  expect(first.manifestSha256).toBe(verification.manifestSha256);
  expect(await Bun.file(path.join(directory, "manifest.json")).text()).toBe(
    manifestText,
  );
});

test("rejects a private match-bound manifest and leaves no output", async () => {
  const input = await rendererSource();
  await Bun.write(
    path.join(input.source, "manifest.json"),
    JSON.stringify({
      ...manifest,
      capabilities: {
        mapId: 11,
        gameMode: "CLASSIC",
        teamSizes: [5, 5],
        rosterCoverage: "recorded-replay",
        replaySha256: sha256("private replay"),
      },
    }),
  );
  await expect(assembleReplayPackage(input)).rejects.toThrow("replaySha256");
  expect(await Bun.file(input.archive).exists()).toBe(false);
});

test("rejects undeclared match-derived resources and leaves no output", async () => {
  const input = await rendererSource();
  await Bun.write(path.join(input.source, "match-tracks.bin"), "private data");
  await expect(assembleReplayPackage(input)).rejects.toThrow(
    "exact manifest inventory",
  );
  expect(await Bun.file(input.archive).exists()).toBe(false);
});

test("preserves an existing output archive", async () => {
  const input = await rendererSource();
  await Bun.write(input.archive, "prior output");
  await expect(assembleReplayPackage(input)).rejects.toThrow("EEXIST");
  expect(await Bun.file(input.archive).text()).toBe("prior output");
});

test("rejects output inside the prepared renderer directory", async () => {
  const input = await rendererSource();
  const archive = path.join(input.source, "package.tar");
  await expect(assembleReplayPackage({ ...input, archive })).rejects.toThrow(
    "outside its source directory",
  );
  expect(await Bun.file(archive).exists()).toBe(false);
});
