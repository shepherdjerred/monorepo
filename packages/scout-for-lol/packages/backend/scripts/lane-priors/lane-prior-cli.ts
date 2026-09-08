import { z } from "zod";

const RawArgsSchema = z.array(z.string());

function flagValue(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  if (index === -1) {
    throw new Error(`Missing required flag ${flag}`);
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function optionalFlagValue(
  args: readonly string[],
  flag: string,
): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseQueueIds(raw: string): number[] {
  const ids = raw.split(",").map((value) => Number(value.trim()));
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Invalid queue ID in ${raw}`);
    }
  }
  return ids;
}

export const LanePriorCliConfigSchema = z.strictObject({
  bucket: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  queueIds: z.array(z.number().int().positive()).min(1),
  output: z.string().min(1),
  awsProfile: z.string().min(1).optional(),
  endpointUrl: z.string().url().optional(),
});

export type LanePriorCliConfig = z.infer<typeof LanePriorCliConfigSchema>;

export const LanePriorEvalCliConfigSchema = LanePriorCliConfigSchema.extend({
  sampleSize: z.number().int().positive(),
  seed: z.string().min(1),
  artifactPath: z.string().min(1),
  threshold: z.number().min(0).max(1),
});

export type LanePriorEvalCliConfig = z.infer<
  typeof LanePriorEvalCliConfigSchema
>;

export function parseLanePriorCliConfig(): LanePriorCliConfig {
  const args = RawArgsSchema.parse(Bun.argv.slice(2));
  return LanePriorCliConfigSchema.parse({
    bucket: flagValue(args, "--bucket"),
    startDate: flagValue(args, "--start-date"),
    endDate: flagValue(args, "--end-date"),
    queueIds: parseQueueIds(flagValue(args, "--queue-ids")),
    output: flagValue(args, "--output"),
    awsProfile: optionalFlagValue(args, "--aws-profile"),
    endpointUrl: optionalFlagValue(args, "--endpoint-url"),
  });
}

export function parseLanePriorEvalCliConfig(): LanePriorEvalCliConfig {
  const args = RawArgsSchema.parse(Bun.argv.slice(2));
  return LanePriorEvalCliConfigSchema.parse({
    bucket: flagValue(args, "--bucket"),
    startDate: flagValue(args, "--start-date"),
    endDate: flagValue(args, "--end-date"),
    queueIds: parseQueueIds(flagValue(args, "--queue-ids")),
    output: flagValue(args, "--output"),
    awsProfile: optionalFlagValue(args, "--aws-profile"),
    endpointUrl: optionalFlagValue(args, "--endpoint-url"),
    sampleSize: Number(flagValue(args, "--sample-size")),
    seed: flagValue(args, "--seed"),
    artifactPath: flagValue(args, "--artifact"),
    threshold: Number(flagValue(args, "--threshold")),
  });
}
