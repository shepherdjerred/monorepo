import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { FIXTURES, ManifestSchema } from "./manifest.ts";

async function command(args: string[]) {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `Synthetic media generator failed (${String(code)}): ${stderr}`,
    );
  return stdout;
}

const [directory, image] = process.argv.slice(2);
if (directory === undefined || image === undefined)
  throw new Error(
    "Usage: prepare.ts <fresh scratch directory> <catalog PMS image>",
  );
if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error("PMS acceptance preparation requires native Linux amd64");
const root = path.resolve(directory);
if (root !== path.resolve("packages/media/.cache/pms-wire"))
  throw new Error(
    "PMS acceptance scratch must be the exact owned checkout path",
  );
await mkdir(path.dirname(root), { recursive: true });
// Existing output indicates a reused workspace: never silently adopt or remove it.
await mkdir(root);
await mkdir(path.join(root, "artifacts"));
const ffmpegOutput = await command(["ffmpeg", "-version"]);
const ffmpegVersion = ffmpegOutput.split("\n")[0];
if (ffmpegVersion === undefined) throw new Error("ffmpeg version missing");
const files = [];
for (const [index, fixture] of FIXTURES.entries()) {
  const filename = path.join(root, "media", fixture.kind, fixture.filename);
  await mkdir(path.dirname(filename), { recursive: true });
  await command([
    "ffmpeg",
    "-nostdin",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=24",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${String(440 + index * 100)}:sample_rate=48000`,
    "-t",
    String(2 + index),
    "-c:v",
    "mpeg4",
    "-q:v",
    "5",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    filename,
  ]);
  const probe = await command([
    "ffprobe",
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    filename,
  ]);
  await writeFile(
    path.join(root, "artifacts", `probe-${String(index)}.json`),
    probe,
  );
  const fileStat = await stat(filename);
  files.push({
    kind: fixture.kind,
    path: filename,
    size: fileStat.size,
    sha256: createHash("sha256")
      .update(await readFile(filename))
      .digest("hex"),
    edition: fixture.edition,
    episodes: [...fixture.episodes],
  });
}
const version = image.split(":")[1]?.split("-amd64@")[0];
const manifest = ManifestSchema.parse({
  schemaVersion: 1,
  image,
  version,
  ffmpegVersion,
  root,
  files,
});
await writeFile(
  path.join(root, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
