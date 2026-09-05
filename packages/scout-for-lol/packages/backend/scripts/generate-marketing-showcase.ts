import { z } from "zod";
import { generateShowcaseAssets } from "#src/showcase/generate.ts";
import { parseShowcaseCliValues } from "./showcase-cli.ts";

const CliFlagNameSchema = z.enum([
  "manifest",
  "out",
  "asset-index",
  "bucket",
  "public-base-path",
]);

const CliValuesSchema = z.strictObject({
  manifest: z.string().optional(),
  out: z.string().optional(),
  "asset-index": z.string().optional(),
  bucket: z.string().optional(),
  "public-base-path": z.string().optional(),
});

const values = CliValuesSchema.parse(
  parseShowcaseCliValues(Bun.argv.slice(2), CliFlagNameSchema),
);

function requiredFlag(name: keyof typeof values): string {
  const value = values[name];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new Error(`Missing required --${name}`);
}

const bucket = values.bucket ?? Bun.env["S3_BUCKET_NAME"];
if (bucket === undefined || bucket.length === 0) {
  throw new Error("S3 bucket is required via --bucket or S3_BUCKET_NAME");
}

await generateShowcaseAssets({
  manifestPath: requiredFlag("manifest"),
  outputDir: requiredFlag("out"),
  assetIndexPath: requiredFlag("asset-index"),
  bucket,
  publicBasePath: values["public-base-path"] ?? "/generated/scout-showcase",
});

await Bun.stdout.write("Generated Scout marketing showcase assets.\n");
