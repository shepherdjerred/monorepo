import { z } from "zod";
import { generateShowcaseAssets } from "#src/showcase/generate.ts";

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

function parseCliValues(args: string[]): z.infer<typeof CliValuesSchema> {
  const entries: [string, string][] = [];
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      throw new Error(`Missing argument at index ${index.toString()}`);
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const raw = arg.slice(2);
    const equalsIndex = raw.indexOf("=");
    const rawName = equalsIndex === -1 ? raw : raw.slice(0, equalsIndex);
    const name = CliFlagNameSchema.parse(rawName);
    if (seen.has(name)) {
      throw new Error(`Duplicate --${name}`);
    }
    seen.add(name);

    const value =
      equalsIndex === -1 ? args[index + 1] : raw.slice(equalsIndex + 1);
    if (value === undefined || value.startsWith("--") || value.length === 0) {
      throw new Error(`Missing value for --${name}`);
    }
    if (equalsIndex === -1) {
      index += 1;
    }
    entries.push([name, value]);
  }

  return CliValuesSchema.parse(Object.fromEntries(entries));
}

const values = parseCliValues(Bun.argv.slice(2));

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
