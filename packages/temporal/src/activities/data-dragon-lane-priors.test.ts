import { describe, expect, test } from "bun:test";
import {
  LANE_PRIOR_ARTIFACT_PATH,
  LANE_PRIOR_EVAL_REPORT_PATH,
  lanePriorArtifactPath,
  lanePriorAwsRegion,
  lanePriorEvalReportPath,
  updateLanePriors,
} from "./data-dragon-lane-priors.ts";

const REPO_DIR = "/tmp/repo";

/**
 * Stands in for the artifact the real generator would have written: the
 * committed copy is already there, and the run rewrites it. Each call returns a
 * later time, so the pre-generation read and the post-generation read differ.
 */
function artifactWritten(): (path: string) => Promise<number | null> {
  let mtimeMs = 1000;
  return async () => {
    mtimeMs += 1000;
    return mtimeMs;
  };
}

const config = {
  bucket: "scout-prod",
  queueIds: [400, 420, 440, 480, 490],
  trainingStartDate: "2026-05-06",
  trainingEndDate: "2026-05-13",
  holdoutStartDate: "2026-05-14",
  holdoutEndDate: "2026-05-16",
  holdoutSampleSize: 100,
  holdoutSeed: "scout-lane-priors-patch-cadence-v1",
  threshold: 0.95,
};

describe("updateLanePriors", () => {
  test("runs generation and eval with explicit date windows", async () => {
    const calls: {
      command: string[];
      cwd: string;
      env: Record<string, string | undefined> | undefined;
    }[] = [];

    await updateLanePriors({
      repoDir: REPO_DIR,
      rawConfig: { ...config, awsRegion: "us-east-1" },
      runCommand: async (command, options) => {
        calls.push({ command, cwd: options.cwd, env: options.env });
        return "";
      },
      artifactMtimeMs: artifactWritten(),
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.cwd).toBe("/tmp/repo/packages/scout-for-lol");
    expect(calls[0]?.command).toEqual([
      "bun",
      "run",
      "--filter=./packages/backend",
      "generate-lane-priors",
      "--",
      "--bucket",
      "scout-prod",
      "--start-date",
      "2026-05-06",
      "--end-date",
      "2026-05-13",
      "--queue-ids",
      "400,420,440,480,490",
      "--output",
      "/tmp/repo/packages/scout-for-lol/packages/data/src/lane-priors/lane-priors.generated.json",
    ]);
    expect(calls[0]?.env).toEqual({
      AWS_REGION: "us-east-1",
      AWS_DEFAULT_REGION: "us-east-1",
      ENVIRONMENT: undefined,
    });
    expect(calls[1]?.cwd).toBe("/tmp/repo/packages/scout-for-lol");
    expect(calls[1]?.command).toEqual([
      "bun",
      "run",
      "--filter=./packages/backend",
      "evaluate-lane-priors",
      "--",
      "--bucket",
      "scout-prod",
      "--start-date",
      "2026-05-14",
      "--end-date",
      "2026-05-16",
      "--queue-ids",
      "400,420,440,480,490",
      "--sample-size",
      "100",
      "--seed",
      "scout-lane-priors-patch-cadence-v1",
      "--threshold",
      "0.95",
      "--artifact",
      "/tmp/repo/packages/scout-for-lol/packages/data/src/lane-priors/lane-priors.generated.json",
      "--output",
      "/tmp/repo/packages/scout-for-lol/packages/data/src/lane-priors/lane-priors.eval-report.generated.json",
    ]);
    expect(calls[1]?.env).toEqual({
      AWS_REGION: "us-east-1",
      AWS_DEFAULT_REGION: "us-east-1",
      ENVIRONMENT: undefined,
    });
  });

  test("passes explicit S3 region to lane-prior commands", async () => {
    const calls: {
      env: Record<string, string | undefined> | undefined;
    }[] = [];

    await updateLanePriors({
      repoDir: REPO_DIR,
      rawConfig: { ...config, awsRegion: "garage" },
      runCommand: async (_command, options) => {
        calls.push({ env: options.env });
        return "";
      },
      artifactMtimeMs: artifactWritten(),
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.env).toEqual({
      AWS_REGION: "garage",
      AWS_DEFAULT_REGION: "garage",
      ENVIRONMENT: undefined,
    });
    expect(calls[1]?.env).toEqual({
      AWS_REGION: "garage",
      AWS_DEFAULT_REGION: "garage",
      ENVIRONMENT: undefined,
    });
  });

  test("resolves AWS region with deterministic fallback order", () => {
    expect(
      lanePriorAwsRegion(
        { ...config, awsRegion: "explicit" },
        {
          AWS_REGION: "aws-region",
          AWS_DEFAULT_REGION: "default-region",
          S3_REGION: "s3-region",
        },
      ),
    ).toBe("explicit");
    expect(
      lanePriorAwsRegion(config, {
        AWS_REGION: "aws-region",
        AWS_DEFAULT_REGION: "default-region",
        S3_REGION: "s3-region",
      }),
    ).toBe("aws-region");
    expect(
      lanePriorAwsRegion(config, {
        AWS_DEFAULT_REGION: "default-region",
        S3_REGION: "s3-region",
      }),
    ).toBe("default-region");
    expect(lanePriorAwsRegion(config, { S3_REGION: "s3-region" })).toBe(
      "s3-region",
    );
    expect(lanePriorAwsRegion(config, {})).toBe("us-east-1");
  });
});

/**
 * Drive the activity with an artifact whose mtime the caller controls and assert
 * it rejects. Both landing failures must stop BEFORE the eval, which would
 * otherwise read a stale or missing artifact and report a meaningless verdict.
 */
async function expectLandingFailure(
  artifactMtimeMs: () => Promise<number | null>,
  message: string,
): Promise<void> {
  const commands: string[][] = [];
  await expect(
    updateLanePriors({
      repoDir: REPO_DIR,
      rawConfig: config,
      runCommand: async (command) => {
        commands.push(command);
        return "";
      },
      artifactMtimeMs,
    }),
  ).rejects.toThrow(message);

  expect(commands).toHaveLength(1);
  expect(commands[0]).toContain("generate-lane-priors");
}

/**
 * `bun run --filter=<pkg>` runs the script with cwd set to that package, NOT to
 * the `cwd` passed alongside it. Every path flag must therefore be absolute.
 *
 * The pre-existing assertions above pinned the literal command array including
 * a repo-root-relative `--output`, so they passed happily while the generator
 * wrote three levels deep inside packages/backend for three months. These
 * assert the property instead of the spelling, so they hold no matter how the
 * command array is rearranged.
 */
describe("lane-prior path flags are cwd-independent", () => {
  const PATH_FLAGS = new Set(["--output", "--artifact"]);

  async function capturePathFlagValues(): Promise<
    { command: string[]; values: string[] }[]
  > {
    const captured: { command: string[]; values: string[] }[] = [];
    await updateLanePriors({
      repoDir: REPO_DIR,
      rawConfig: config,
      runCommand: async (command) => {
        const values = command.filter(
          (_arg, index) =>
            index > 0 && PATH_FLAGS.has(command[index - 1] ?? ""),
        );
        captured.push({ command, values });
        return "";
      },
      artifactMtimeMs: artifactWritten(),
    });
    return captured;
  }

  test("every --output/--artifact value is absolute and under repoDir", async () => {
    const captured = await capturePathFlagValues();

    // Guard the guard: if the flags are ever renamed this test must not quietly
    // start asserting nothing.
    const allValues = captured.flatMap((call) => call.values);
    expect(allValues.length).toBeGreaterThanOrEqual(3);

    for (const { command, values } of captured) {
      expect(command).toContain("--filter=./packages/backend");
      for (const value of values) {
        expect(value.startsWith(`${REPO_DIR}/`)).toBe(true);
      }
    }
  });

  test("no path flag is passed repo-root-relative", async () => {
    const captured = await capturePathFlagValues();
    const allValues = captured.flatMap((call) => call.values);

    // The exact regression: the repo-root-relative constants reaching the CLI.
    expect(allValues).not.toContain(LANE_PRIOR_ARTIFACT_PATH);
    expect(allValues).not.toContain(LANE_PRIOR_EVAL_REPORT_PATH);
  });

  test("the constants themselves stay repo-root-relative", () => {
    // git add / the Data Dragon allowlist compare these against
    // `git status --porcelain` output, which is repo-root-relative. Making
    // them absolute would silently break staging and the allowlist instead.
    expect(LANE_PRIOR_ARTIFACT_PATH.startsWith("packages/")).toBe(true);
    expect(LANE_PRIOR_EVAL_REPORT_PATH.startsWith("packages/")).toBe(true);
    expect(lanePriorArtifactPath(REPO_DIR)).toBe(
      `${REPO_DIR}/${LANE_PRIOR_ARTIFACT_PATH}`,
    );
    expect(lanePriorEvalReportPath(REPO_DIR)).toBe(
      `${REPO_DIR}/${LANE_PRIOR_EVAL_REPORT_PATH}`,
    );
  });

  test("throws when generation reported success but wrote no artifact", async () => {
    await expectLandingFailure(
      async () => null,
      `Lane-prior generation reported success but wrote no artifact at ${lanePriorArtifactPath(REPO_DIR)}`,
    );
  });

  // The regression that an existence check cannot catch. `lane-priors.generated
  // .json` is committed, so the bot's fresh clone already holds the previous
  // run's copy: a generator that writes nowhere near it still leaves a present,
  // parseable file. Modelled as an mtime that does not move across generation.
  test("throws when generation left the committed artifact untouched", async () => {
    await expectLandingFailure(
      async () => 1_700_000_000_000,
      `left the committed artifact at ${lanePriorArtifactPath(REPO_DIR)} untouched`,
    );
  });
});
