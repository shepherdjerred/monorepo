import { z } from "zod/v4";

const SCOUT_ROOT = "packages/scout-for-lol";
const DATA_PACKAGE_ROOT = `${SCOUT_ROOT}/packages/data`;

export const LANE_PRIOR_ARTIFACT_PATH = `${DATA_PACKAGE_ROOT}/src/lane-priors/lane-priors.generated.json`;
export const LANE_PRIOR_EVAL_REPORT_PATH = `${DATA_PACKAGE_ROOT}/src/lane-priors/lane-priors.eval-report.generated.json`;

const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const LanePriorUpdateConfigSchema = z.strictObject({
  bucket: z.string().min(1),
  queueIds: z.array(z.number().int().positive()).min(1),
  trainingStartDate: DateOnlySchema,
  trainingEndDate: DateOnlySchema,
  holdoutStartDate: DateOnlySchema,
  holdoutEndDate: DateOnlySchema,
  holdoutSampleSize: z.number().int().positive(),
  holdoutSeed: z.string().min(1),
  threshold: z.number().min(0).max(1),
  awsProfile: z.string().min(1).optional(),
  awsRegion: z.string().min(1).optional(),
  endpointUrl: z.url().optional(),
});

export type LanePriorUpdateConfig = z.infer<typeof LanePriorUpdateConfigSchema>;

type RunCommand = (
  command: string[],
  options: {
    cwd: string;
    env?: Record<string, string | undefined>;
    redactOutput?: boolean;
  },
) => Promise<string>;

export function queueIdCsv(queueIds: readonly number[]): string {
  return queueIds.map((queueId) => queueId.toString()).join(",");
}

function optionalFlag(name: string, value: string | undefined): string[] {
  return value === undefined ? [] : [name, value];
}

export function lanePriorAwsRegion(
  config: LanePriorUpdateConfig,
  env: Record<string, string | undefined> = Bun.env,
): string {
  return (
    config.awsRegion ??
    env["AWS_REGION"] ??
    env["AWS_DEFAULT_REGION"] ??
    env["S3_REGION"] ??
    "us-east-1"
  );
}

export function lanePriorPrBodyLines(
  rawConfig: LanePriorUpdateConfig,
): string[] {
  const config = LanePriorUpdateConfigSchema.parse(rawConfig);
  return [
    "Lane prior refresh:",
    `Queues: ${queueIdCsv(config.queueIds)}`,
    `Training window: ${config.trainingStartDate} to ${config.trainingEndDate}`,
    `Holdout window: ${config.holdoutStartDate} to ${config.holdoutEndDate}`,
    `Holdout sample size: ${config.holdoutSampleSize.toString()}`,
    `Eval threshold: ${config.threshold.toString()}`,
  ];
}

export async function updateLanePriors(input: {
  repoDir: string;
  rawConfig: LanePriorUpdateConfig;
  runCommand: RunCommand;
}): Promise<void> {
  const config = LanePriorUpdateConfigSchema.parse(input.rawConfig);
  const endpointUrl = config.endpointUrl ?? Bun.env["S3_ENDPOINT"];
  const queueIds = queueIdCsv(config.queueIds);
  const awsRegion = lanePriorAwsRegion(config);
  const commandEnv = {
    AWS_REGION: awsRegion,
    AWS_DEFAULT_REGION: awsRegion,
    ENVIRONMENT: undefined,
  };

  await input.runCommand(
    [
      "bun",
      "run",
      "--filter=./packages/backend",
      "generate-lane-priors",
      "--",
      "--bucket",
      config.bucket,
      "--start-date",
      config.trainingStartDate,
      "--end-date",
      config.trainingEndDate,
      "--queue-ids",
      queueIds,
      "--output",
      LANE_PRIOR_ARTIFACT_PATH,
      ...optionalFlag("--aws-profile", config.awsProfile),
      ...optionalFlag("--endpoint-url", endpointUrl),
    ],
    { cwd: `${input.repoDir}/${SCOUT_ROOT}`, env: commandEnv },
  );

  await input.runCommand(
    [
      "bun",
      "run",
      "--filter=./packages/backend",
      "evaluate-lane-priors",
      "--",
      "--bucket",
      config.bucket,
      "--start-date",
      config.holdoutStartDate,
      "--end-date",
      config.holdoutEndDate,
      "--queue-ids",
      queueIds,
      "--sample-size",
      config.holdoutSampleSize.toString(),
      "--seed",
      config.holdoutSeed,
      "--threshold",
      config.threshold.toString(),
      "--artifact",
      LANE_PRIOR_ARTIFACT_PATH,
      "--output",
      LANE_PRIOR_EVAL_REPORT_PATH,
      ...optionalFlag("--aws-profile", config.awsProfile),
      ...optionalFlag("--endpoint-url", endpointUrl),
    ],
    { cwd: `${input.repoDir}/${SCOUT_ROOT}`, env: commandEnv },
  );
}
