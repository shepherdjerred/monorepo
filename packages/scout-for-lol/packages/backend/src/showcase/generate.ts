import type { S3Client } from "@aws-sdk/client-s3";
import { RawCurrentGameInfoSchema, RawMatchSchema } from "@scout-for-lol/data";
import { discordScreenshotToImage } from "@scout-for-lol/report";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  ShowcaseAssetIndexSchema,
  ShowcaseManifestSchema,
  type ShowcaseAsset,
  type ShowcaseEntry,
  type ShowcaseManifest,
  validateRequiredShowcaseCoverage,
} from "#src/showcase/manifest.ts";
import { readS3JsonOptional, readS3ObjectBytes } from "#src/showcase/s3.ts";
import {
  safeFileName,
  type GenerateEntryContext,
  type GeneratedImage,
} from "#src/showcase/generate-types.ts";
import { generateCompetitionGraph } from "#src/showcase/competition-graph.ts";
import { generateReportGraph } from "#src/showcase/report-graph.ts";

export type GenerateShowcaseOptions = {
  manifestPath: string;
  outputDir: string;
  assetIndexPath: string;
  publicBasePath: string;
  bucket: string;
  client?: S3Client;
  generatedAt?: Date;
};

function optionalEntryFields(entry: ShowcaseEntry) {
  return {
    ...(entry.description === undefined
      ? {}
      : { description: entry.description }),
    ...(entry.state === undefined ? {} : { state: entry.state }),
    ...(entry.queue === undefined ? {} : { queue: entry.queue }),
    ...(entry.playerCount === undefined
      ? {}
      : { playerCount: entry.playerCount }),
  };
}

function joinPath(directory: string, fileName: string): string {
  return `${directory.replace(/\/+$/, "")}/${fileName}`;
}

async function loadManifest(manifestPath: string): Promise<ShowcaseManifest> {
  const text = await Bun.file(manifestPath).text();
  const parsed: unknown = JSON.parse(text);
  return ShowcaseManifestSchema.parse(parsed);
}

async function writeImage(params: {
  outputDir: string;
  image: GeneratedImage;
}): Promise<void> {
  await Bun.write(
    joinPath(params.outputDir, params.image.fileName),
    params.image.bytes,
    { createPath: true },
  );
}

async function validateDataKey(params: {
  entry: ShowcaseEntry;
  bucket: string;
  client: S3Client;
  key: string;
}): Promise<void> {
  const payload = await readS3JsonOptional({
    client: params.client,
    bucket: params.bucket,
    key: params.key,
  });
  if (payload === undefined) {
    // A very recent match can have its report image uploaded before the
    // match.json; skip the sanity check rather than fail the whole gallery.
    process.stderr.write(
      `Showcase: dataKey missing for ${params.entry.id}, skipping validation (${params.key}).\n`,
    );
    return;
  }

  if (params.entry.state === "prematch") {
    RawCurrentGameInfoSchema.parse(payload);
    return;
  }

  if (params.entry.state === "postmatch") {
    RawMatchSchema.parse(payload);
    return;
  }

  throw new Error(
    `Cannot validate dataKey for ${params.entry.id} without state`,
  );
}

async function generateS3Image(
  entry: Extract<ShowcaseEntry, { kind: "s3-image" }>,
  ctx: GenerateEntryContext,
): Promise<GeneratedImage> {
  if (entry.dataKey !== undefined) {
    await validateDataKey({
      entry,
      bucket: ctx.bucket,
      client: ctx.client,
      key: entry.dataKey,
    });
  }

  const bytes = await readS3ObjectBytes({
    client: ctx.client,
    bucket: ctx.bucket,
    key: entry.imageKey,
  });
  return {
    fileName: safeFileName(entry.id, "png"),
    bytes,
    sourceKeys:
      entry.dataKey === undefined
        ? [entry.imageKey]
        : [entry.imageKey, entry.dataKey],
  };
}

async function generateDiscordScreenshot(
  entry: Extract<ShowcaseEntry, { kind: "discord-screenshot" }>,
  ctx: GenerateEntryContext,
): Promise<GeneratedImage> {
  if (entry.dataKey !== undefined) {
    await validateDataKey({
      entry,
      bucket: ctx.bucket,
      client: ctx.client,
      key: entry.dataKey,
    });
  }
  const embeddedImageBytes = await readS3ObjectBytes({
    client: ctx.client,
    bucket: ctx.bucket,
    key: entry.imageKey,
  });
  const bytes = await discordScreenshotToImage({
    embeddedImageBytes,
    ...entry,
  });
  return {
    fileName: safeFileName(entry.id, "png"),
    bytes,
    sourceKeys:
      entry.dataKey === undefined
        ? [entry.imageKey]
        : [entry.imageKey, entry.dataKey],
  };
}

async function generateImageForEntry(
  entry: Exclude<ShowcaseEntry, { kind: "unsupported" }>,
  ctx: GenerateEntryContext,
): Promise<GeneratedImage> {
  switch (entry.kind) {
    case "s3-image":
      return await generateS3Image(entry, ctx);
    case "discord-screenshot":
      return await generateDiscordScreenshot(entry, ctx);
    case "competition-graph":
      return await generateCompetitionGraph(entry, ctx);
    case "report-graph":
      return await generateReportGraph(entry, ctx);
  }
}

function unsupportedAsset(
  entry: Extract<ShowcaseEntry, { kind: "unsupported" }>,
): ShowcaseAsset {
  return {
    id: entry.id,
    title: entry.title,
    group: entry.group,
    kind: "unsupported",
    status: "unsupported",
    sourceKeys: [],
    reason: entry.reason,
    ...optionalEntryFields(entry),
  };
}

function generatedAsset(params: {
  entry: Exclude<ShowcaseEntry, { kind: "unsupported" }>;
  image: GeneratedImage;
  publicBasePath: string;
}): ShowcaseAsset {
  return {
    id: params.entry.id,
    title: params.entry.title,
    group: params.entry.group,
    kind: params.entry.kind,
    status: "generated",
    fileName: params.image.fileName,
    src: `${params.publicBasePath}/${params.image.fileName}`,
    byteLength: params.image.bytes.length,
    sourceKeys: params.image.sourceKeys,
    ...optionalEntryFields(params.entry),
  };
}

async function generateEntry(
  entry: ShowcaseEntry,
  ctx: GenerateEntryContext,
): Promise<ShowcaseAsset> {
  if (entry.kind === "unsupported") {
    return unsupportedAsset(entry);
  }

  const image = await generateImageForEntry(entry, ctx);
  await writeImage({ outputDir: ctx.outputDir, image });
  return generatedAsset({
    entry,
    image,
    publicBasePath: ctx.publicBasePath,
  });
}

export async function generateShowcaseAssets(
  options: GenerateShowcaseOptions,
): Promise<void> {
  const manifest = await loadManifest(options.manifestPath);
  const generatedAt = (options.generatedAt ?? new Date()).toISOString();
  const client = options.client ?? createS3Client();
  const ctx: GenerateEntryContext = {
    bucket: options.bucket,
    client,
    outputDir: options.outputDir,
    publicBasePath: options.publicBasePath,
  };

  const assets: ShowcaseAsset[] = [];
  for (const entry of manifest.entries) {
    assets.push(await generateEntry(entry, ctx));
  }

  const index = ShowcaseAssetIndexSchema.parse({
    version: 1,
    generatedAt,
    assets,
  });
  validateRequiredShowcaseCoverage(index);

  await Bun.write(
    options.assetIndexPath,
    `${JSON.stringify(index, null, 2)}\n`,
    { createPath: true },
  );
}
