import path from "node:path";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { RunSchema, type CaptureRun } from "#src/capture/model.ts";
import { DocsFramesSchema } from "#protocol/media.ts";
import { retainBlob, cachedBlob, type BlobStore } from "./store.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const suiteFile = z
  .string()
  .min(1)
  .refine(
    (file) =>
      !file.includes("\\") &&
      !file
        .split("/")
        .some((part) => part === "" || part === "." || part === ".."),
    "Suite file must be a repository-relative path",
  );
const FileSchema = z.strictObject({
  path: z
    .string()
    .regex(
      /^[a-z0-9-]+\/(?:source\.png|frames\.json|\d{6}\.png|presentation\.json)$/u,
    ),
  sha256: hash,
});
export const ArchiveSchema = z.strictObject({
  schema: z.literal(1),
  run: RunSchema,
  files: z.array(FileSchema).min(1),
});
export const SuiteRunSchema = z.strictObject({
  schema: z.literal(1),
  id: z.uuid(),
  suite: z.string(),
  suiteFile,
  fixture: hash,
  runtime: hash,
  rollout: hash.nullable(),
  selection: z.strictObject({
    scenario: z.string().optional(),
    shot: z.string().optional(),
  }),
  scenarios: z.array(z.strictObject({ id: z.string(), archive: hash })),
});
export type SuiteRun = z.infer<typeof SuiteRunSchema>;

export function retainedSuiteFile(repoRoot: string, run: SuiteRun): string {
  return path.join(repoRoot, suiteFile.parse(run.suiteFile));
}

export function relativeSuiteFile(repoRoot: string, file: string): string {
  return suiteFile.parse(path.relative(repoRoot, file));
}

export async function archiveCapture(
  store: BlobStore,
  run: CaptureRun,
): Promise<string> {
  if (run.state !== "complete")
    throw new Error("Only complete captures can be retained");
  const files: z.infer<typeof FileSchema>[] = [];
  for (const capture of run.captures) {
    const sourceName = capture.source.endsWith(".png")
      ? "source.png"
      : "frames.json";
    const sourceHash = await retainBlob(
      store,
      new Uint8Array(await Bun.file(capture.source).arrayBuffer()),
    );
    if (sourceHash !== capture.sourceHash)
      throw new Error("Capture source changed before archival");
    files.push({ path: `${capture.name}/${sourceName}`, sha256: sourceHash });
    files.push({
      path: `${capture.name}/presentation.json`,
      sha256: await retainBlob(
        store,
        new Uint8Array(await Bun.file(capture.presentation).arrayBuffer()),
      ),
    });
    if (sourceName === "frames.json") {
      const receipt = DocsFramesSchema.parse(
        await Bun.file(capture.source).json(),
      );
      for (const [index, frame] of receipt.frames.entries()) {
        files.push({
          path: `${capture.name}/${frame.file}`,
          sha256: await retainBlob(
            store,
            new Uint8Array(
              await Bun.file(
                path.join(path.dirname(capture.source), frame.file),
              ).arrayBuffer(),
            ),
          ),
        });
        if ((index + 1) % 30 === 0 || index + 1 === receipt.frames.length)
          process.stderr.write(
            `[capture] retain ${capture.name}: ${(index + 1).toString()}/${receipt.frames.length.toString()} frames\n`,
          );
      }
    }
  }
  // The proof retains provenance, without a copy of the player's inventory or checkpoint.
  const proof = { ...run, checkpoint: null, snapshot: null, inspection: null };
  const archive = ArchiveSchema.parse({ schema: 1, run: proof, files });
  return retainBlob(store, new TextEncoder().encode(JSON.stringify(archive)));
}

export async function restoreCapture(
  store: BlobStore,
  options: { cache: string; archive: string; destination: string },
): Promise<CaptureRun> {
  const archive = ArchiveSchema.parse(
    await Bun.file(
      await cachedBlob(store, options.cache, options.archive),
    ).json(),
  );
  const names = new Set(archive.files.map((f) => f.path));
  if (names.size !== archive.files.length)
    throw new Error("Duplicate archive file");
  for (const file of archive.files) {
    const target = path.join(options.destination, file.path);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await Bun.write(
      target,
      Bun.file(await cachedBlob(store, options.cache, file.sha256)),
    );
  }
  return {
    ...archive.run,
    captures: archive.run.captures.map((capture) => {
      const image = `${capture.name}/source.png`,
        video = `${capture.name}/frames.json`;
      const source = names.has(image) ? image : video;
      if (!names.has(source) || !names.has(`${capture.name}/presentation.json`))
        throw new Error("Incomplete capture archive");
      return {
        ...capture,
        source: path.join(options.destination, source),
        presentation: path.join(
          options.destination,
          capture.name,
          "presentation.json",
        ),
      };
    }),
  };
}

export async function readSuiteRun(
  store: BlobStore,
  cache: string,
  id: string,
): Promise<SuiteRun> {
  z.uuid().parse(id);
  const pointer = z
    .strictObject({ sha256: hash })
    .parse(
      JSON.parse(new TextDecoder().decode(await store.read(`runs/${id}.json`))),
    );
  const result = SuiteRunSchema.parse(
    await Bun.file(await cachedBlob(store, cache, pointer.sha256)).json(),
  );
  if (result.id !== id) throw new Error("Run index identity differs");
  return result;
}

export async function retainSuiteRun(
  store: BlobStore,
  run: SuiteRun,
): Promise<void> {
  SuiteRunSchema.parse(run);
  const sha256 = await retainBlob(
    store,
    new TextEncoder().encode(JSON.stringify(run)),
  );
  const pointer = new TextEncoder().encode(JSON.stringify({ sha256 }));
  await store.write(`runs/${run.id}.json`, pointer);
  if (
    new TextDecoder().decode(await store.read(`runs/${run.id}.json`)) !==
    new TextDecoder().decode(pointer)
  )
    throw new Error("Run index readback differs");
}
