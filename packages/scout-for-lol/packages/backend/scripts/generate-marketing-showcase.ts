import { parseArgs } from "node:util";
import { generateShowcaseAssets } from "#src/showcase/generate.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    manifest: { type: "string" },
    out: { type: "string" },
    "asset-index": { type: "string" },
    bucket: { type: "string" },
    "public-base-path": { type: "string" },
  },
  strict: true,
});

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
