import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { importReportStoreFromS3 } from "#src/report-store/s3-importer.ts";

const ArgsSchema = z.object({
  source: z.string().min(1).default("s3-report-store"),
  maxObjects: z.number().int().positive().optional(),
  batchSize: z.number().int().positive().optional(),
  prefixes: z.array(z.string().min(1)).default(["games/", "prematch/"]),
  resume: z.boolean().default(true),
});

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseOptionalPositiveInt(
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got "${value}"`);
  }
  return parsed;
}

function parseArgs(argv: string[]) {
  const prefixValues = argv.flatMap((arg, index) =>
    arg === "--prefix" ? [argv[index + 1] ?? ""] : [],
  );

  return ArgsSchema.parse({
    source: readFlagValue(argv, "--source") ?? "s3-report-store",
    maxObjects: parseOptionalPositiveInt(readFlagValue(argv, "--max-objects")),
    batchSize: parseOptionalPositiveInt(readFlagValue(argv, "--batch-size")),
    prefixes: prefixValues.length > 0 ? prefixValues : ["games/", "prematch/"],
    resume: !hasFlag(argv, "--no-resume"),
  });
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  const bucket = Bun.env["S3_BUCKET_NAME"];
  if (bucket === undefined || bucket.length === 0) {
    throw new Error("S3_BUCKET_NAME is required");
  }

  const summary = await importReportStoreFromS3({
    prisma,
    bucket,
    source: args.source,
    maxObjects: args.maxObjects,
    batchSize: args.batchSize,
    prefixes: args.prefixes,
    resume: args.resume,
  });

  console.log(JSON.stringify(summary, null, 2));
}

try {
  await main();
  await prisma.$disconnect();
  process.exit(0);
} catch (error) {
  await prisma.$disconnect();
  throw error;
}
