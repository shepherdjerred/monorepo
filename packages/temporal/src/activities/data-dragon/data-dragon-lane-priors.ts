import { z } from "zod/v4";
import { revertGeneratedAtOnlyChanges } from "#activities/scout/scout-season-refresh-git.ts";

const SCOUT_ROOT = "packages/scout-for-lol";
const DATA_PACKAGE_ROOT = `${SCOUT_ROOT}/packages/data`;

/**
 * Repo-root-relative, and they must STAY that way: these two constants feed
 * `DATA_DRAGON_GENERATED_PATHS` (`git add --`, run with cwd=repoDir) and
 * `isAllowedDataDragonGeneratedPath`, which compares them against
 * `git status --porcelain` output. Both are repo-root-relative by definition.
 *
 * They are NOT usable as-is for the lane-prior CLI's `--output`/`--artifact`
 * flags — see `lanePriorArtifactPath` below.
 */
export const LANE_PRIOR_ARTIFACT_PATH = `${DATA_PACKAGE_ROOT}/src/lane-priors/lane-priors.generated.json`;
export const LANE_PRIOR_EVAL_REPORT_PATH = `${DATA_PACKAGE_ROOT}/src/lane-priors/lane-priors.eval-report.generated.json`;

/**
 * Absolute paths for the lane-prior CLI's path flags.
 *
 * `bun run --filter=./packages/backend <script>` executes the script with cwd
 * set to the FILTERED PACKAGE (`<repoDir>/packages/scout-for-lol/packages/backend`),
 * not to the `cwd` this activity passes to `runCommand` and not to the repo
 * root. `generate-lane-priors.ts` writes with a plain `Bun.write(config.output)`
 * and `evaluate-lane-priors.ts` reads with `Bun.file(config.artifactPath)`, both
 * of which resolve against that cwd.
 *
 * Passing the repo-root-relative constants therefore wrote the artifact to
 * `.../packages/backend/packages/scout-for-lol/packages/data/src/lane-priors/...`
 * — an untracked tree that `git status --porcelain` collapses to
 * `packages/scout-for-lol/packages/backend/packages/`, which is exactly what
 * tripped the Data Dragon allowlist and reddened every run from 2026-08-08.
 * The committed artifact was never updated once between 2026-05-17 and then,
 * and the eval step read back the same misplaced file, so it validated the
 * wrong artifact and reported success.
 */
export function lanePriorArtifactPath(repoDir: string): string {
  return `${repoDir}/${LANE_PRIOR_ARTIFACT_PATH}`;
}

export function lanePriorEvalReportPath(repoDir: string): string {
  return `${repoDir}/${LANE_PRIOR_EVAL_REPORT_PATH}`;
}

export async function lanePriorContentHash(repoDir: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(lanePriorArtifactPath(repoDir)).text());
  hasher.update("\0");
  hasher.update(await Bun.file(lanePriorEvalReportPath(repoDir)).text());
  return hasher.digest("hex").slice(0, 12);
}

export function lanePriorBranchName(contentHash: string): string {
  return `chore/scout-lane-priors-${contentHash}`;
}

export function lanePriorPrTitle(): string {
  return "chore: refresh Scout lane priors";
}

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

/**
 * Last-modified time of the artifact, or null when it does not exist.
 *
 * Injected so the stub-`runCommand` tests stay hermetic (no real filesystem).
 * Modification time rather than a content hash, because the question is whether
 * the generator WROTE this run, not whether the result differs: a run that
 * legitimately reproduces identical bytes still has to count as written, and a
 * hash comparison would reject it.
 */
type ArtifactMtimeMs = (path: string) => Promise<number | null>;

async function defaultArtifactMtimeMs(path: string): Promise<number | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return null;
  }
  const stat = await file.stat();
  return stat.mtimeMs;
}

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

/**
 * The lane-prior generator stamps a fresh `generatedAt` on every run, while its
 * training window is pinned in SCOUT_LANE_PRIOR_UPDATE_CONFIG — so a run over
 * unchanged S3 matches produces a diff of exactly two timestamps. Left alone
 * that would open a PR on every weekly refresh whose entire content is those
 * stamps (version-check runs already carry real asset changes alongside them).
 *
 * Called before `changedFiles`, so the allowlist, the PR decision, and
 * `git add` all simply never see a churn-only lane-prior change. Returns the
 * paths it restored, for logging.
 */
export async function revertGeneratedAtOnlyLanePriorChanges(
  repoDir: string,
): Promise<string[]> {
  return await revertGeneratedAtOnlyChanges(repoDir, [
    LANE_PRIOR_ARTIFACT_PATH,
    LANE_PRIOR_EVAL_REPORT_PATH,
  ]);
}

export async function updateLanePriors(input: {
  repoDir: string;
  rawConfig: LanePriorUpdateConfig;
  runCommand: RunCommand;
  artifactMtimeMs?: ArtifactMtimeMs;
}): Promise<void> {
  const config = LanePriorUpdateConfigSchema.parse(input.rawConfig);
  const endpointUrl = config.endpointUrl ?? Bun.env["S3_ENDPOINT"];
  const queueIds = queueIdCsv(config.queueIds);
  const awsRegion = lanePriorAwsRegion(config);
  const artifactPath = lanePriorArtifactPath(input.repoDir);
  const artifactMtimeMs = input.artifactMtimeMs ?? defaultArtifactMtimeMs;
  // Read BEFORE generating: the artifact is committed, so it is already on disk
  // in the bot's fresh clone and its mere presence afterwards proves nothing.
  const mtimeBeforeGeneration = await artifactMtimeMs(artifactPath);
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
      artifactPath,
      ...optionalFlag("--aws-profile", config.awsProfile),
      ...optionalFlag("--endpoint-url", endpointUrl),
    ],
    { cwd: `${input.repoDir}/${SCOUT_ROOT}`, env: commandEnv },
  );

  // The generator exits 0 whether or not `--output` landed where we asked, so
  // a cwd-relative path silently produced a stray tree for three months. Assert
  // the landing before the eval reads it back, so a future path regression
  // fails here — naming the exact missing file — instead of surfacing as an
  // unrelated-looking allowlist rejection several steps later.
  //
  // Existence alone cannot say that: `lane-priors.generated.json` is committed,
  // so the clone already carries the PREVIOUS run's copy and a generator that
  // wrote nowhere near it leaves a file that still reads as present and valid —
  // which is the same three-month failure wearing a different face. Only a
  // changed modification time shows this run produced it.
  const mtimeAfterGeneration = await artifactMtimeMs(artifactPath);
  if (mtimeAfterGeneration === null) {
    throw new Error(
      `Lane-prior generation reported success but wrote no artifact at ${artifactPath}. ` +
        `The lane-prior CLI resolves its path flags against its own cwd, which ` +
        `\`bun run --filter\` sets to the filtered package — pass absolute paths.`,
    );
  }
  if (mtimeAfterGeneration === mtimeBeforeGeneration) {
    throw new Error(
      `Lane-prior generation reported success but left the committed artifact at ` +
        `${artifactPath} untouched, so it still holds the previous run's data. ` +
        `The lane-prior CLI resolves its path flags against its own cwd, which ` +
        `\`bun run --filter\` sets to the filtered package — pass absolute paths.`,
    );
  }

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
      artifactPath,
      "--output",
      lanePriorEvalReportPath(input.repoDir),
      ...optionalFlag("--aws-profile", config.awsProfile),
      ...optionalFlag("--endpoint-url", endpointUrl),
    ],
    { cwd: `${input.repoDir}/${SCOUT_ROOT}`, env: commandEnv },
  );
}
