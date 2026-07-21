#!/usr/bin/env bun

import { z } from "zod";

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const ImageManifestSchema = z
  .object({
    target: z.string().min(1),
    image: z.string().min(1),
    imageId: DigestSchema,
    rootfsLayers: z.array(DigestSchema),
    os: z.string().min(1),
    architecture: z.string().min(1),
    smokePassed: z.literal(true),
  })
  .strict();

const BuildManifestSchema = z
  .object({
    selectedBakeTargets: z.array(z.string().min(1)),
    images: z.array(ImageManifestSchema).min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const selected = [...new Set(manifest.selectedBakeTargets)].sort();
    if (
      JSON.stringify(selected) !== JSON.stringify(manifest.selectedBakeTargets)
    ) {
      context.addIssue({
        code: "custom",
        message: "selectedBakeTargets must be sorted and unique",
      });
    }
    const imageTargets = manifest.images.map((image) => image.target);
    const sortedImageTargets = [...new Set(imageTargets)].sort();
    if (JSON.stringify(sortedImageTargets) !== JSON.stringify(imageTargets)) {
      context.addIssue({
        code: "custom",
        message: "images must have sorted, unique targets",
      });
    }
  });

export function compareImageManifests(
  baselineInput: unknown,
  candidateInput: unknown,
): void {
  const baseline = BuildManifestSchema.parse(baselineInput);
  const candidate = BuildManifestSchema.parse(candidateInput);
  if (JSON.stringify(baseline) !== JSON.stringify(candidate)) {
    throw new Error(
      "Buildx candidate image manifest differs from the baseline",
    );
  }
}

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await Bun.file(path).text());
}

async function main(): Promise<void> {
  const [baselinePath, candidatePath, extra] = Bun.argv.slice(2);
  if (
    baselinePath === undefined ||
    candidatePath === undefined ||
    extra !== undefined
  ) {
    throw new Error(
      "Usage: compare-image-manifests.ts <baseline.json> <candidate.json>",
    );
  }
  compareImageManifests(
    await loadJson(baselinePath),
    await loadJson(candidatePath),
  );
  console.log("Buildx baseline and candidate image manifests are identical");
}

if (import.meta.main) {
  await main();
}
