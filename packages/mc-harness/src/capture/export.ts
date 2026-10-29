import { cp, lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PublicMediaSchema } from "#protocol/media.ts";
import { mediaMarkup } from "#protocol/media-markup.ts";
import type { CaptureRun } from "./model.ts";
import { sha256 } from "./media.ts";

const DerivationSchema = z.strictObject({
  sourceSha256: z.string(),
  presentationSha256: z.string(),
  outputs: z.array(
    z.strictObject({
      file: z
        .string()
        .regex(
          /^(?:media\.json|poster\.webp|original\.webp|annotated\.webp|clip\.mp4|annotated\.mp4)$/u,
        ),
      sha256: z.string(),
    }),
  ),
});
const generated = new Set([
  "media.json",
  "poster.webp",
  "original.webp",
  "annotated.webp",
  "clip.mp4",
  "annotated.mp4",
]);

async function existingDirectory(directory: string): Promise<boolean> {
  try {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Media destination is not an owned directory");
    const entries = await readdir(directory);
    if (entries.some((file) => !generated.has(file)))
      throw new Error("Media destination contains unrelated files");
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

async function install(
  source: string,
  destination: string,
  files: readonly string[],
  backupRoot: string,
): Promise<void> {
  const staging = `${destination}.stage-${randomUUID()}`;
  const previous = `${destination}.previous-${randomUUID()}`;
  await mkdir(path.dirname(destination), { recursive: true });
  await mkdir(staging);
  let moved = false;
  try {
    for (const file of files)
      await cp(path.join(source, file), path.join(staging, file), {
        errorOnExist: true,
        force: false,
      });
    if (await existingDirectory(destination)) {
      const old = PublicMediaSchema.parse(
        await Bun.file(path.join(destination, "media.json")).json(),
      );
      if (old.name !== path.basename(destination))
        throw new Error("Existing media identity differs");
      await rename(destination, previous);
      moved = true;
    }
    try {
      await rename(staging, destination);
    } catch (error) {
      if (moved) await rename(previous, destination);
      throw error;
    }
    if (moved) {
      await mkdir(backupRoot, { recursive: true, mode: 0o700 });
      await cp(
        previous,
        path.join(backupRoot, `${path.basename(destination)}-${randomUUID()}`),
        { recursive: true, errorOnExist: true, force: false },
      );
      await rm(previous, { recursive: true });
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function requirePublishable(run: CaptureRun): void {
  if (
    (run.target !== "live" && run.mapSource === undefined) ||
    run.state !== "complete"
  )
    throw new Error(
      "Docs export requires a completed live or real-map capture",
    );
}

/** Publishes verified derivatives from restored live runs or fingerprinted real-map copies. */
export async function exportMedia(
  run: CaptureRun,
  rendered: string,
  docsPublic: string,
): Promise<string[]> {
  requirePublishable(run);
  const snippets: string[] = [];
  for (const capture of run.captures) {
    const source = path.join(rendered, capture.name);
    const derivation = DerivationSchema.parse(
      await Bun.file(path.join(source, "derivation.json")).json(),
    );
    if (
      (await sha256(capture.source)) !== capture.sourceHash ||
      derivation.sourceSha256 !== capture.sourceHash ||
      (await sha256(capture.presentation)) !== derivation.presentationSha256
    )
      throw new Error(
        "Capture or annotations changed since rendering; render again",
      );
    const manifest = PublicMediaSchema.parse(
      await Bun.file(path.join(source, "media.json")).json(),
    );
    if (manifest.name !== capture.name)
      throw new Error("Rendered media identity differs from its capture");
    const files = [
      "media.json",
      "poster.webp",
      manifest.kind === "video" ? "clip.mp4" : "original.webp",
      manifest.kind === "video" ? "annotated.mp4" : "annotated.webp",
    ];
    for (const file of files) {
      const expected = derivation.outputs.find(
        (output) => output.file === file,
      );
      if ((await sha256(path.join(source, file))) !== expected?.sha256)
        throw new Error(`Rendered output changed: ${file}`);
    }
    await install(
      source,
      path.join(docsPublic, "media", manifest.name),
      files,
      path.join(path.dirname(rendered), "exports-before"),
    );
    snippets.push(mediaMarkup(manifest));
  }
  return snippets;
}
