import { describe, expect, test } from "bun:test";
import {
  LANE_PRIOR_ARTIFACT_PATH,
  LANE_PRIOR_EVAL_REPORT_PATH,
  lanePriorAwsRegion,
  updateLanePriors,
} from "./data-dragon-lane-priors.ts";

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
      repoDir: "/tmp/repo",
      rawConfig: config,
      runCommand: async (command, options) => {
        calls.push({ command, cwd: options.cwd, env: options.env });
        return "";
      },
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
      LANE_PRIOR_ARTIFACT_PATH,
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
      LANE_PRIOR_ARTIFACT_PATH,
      "--output",
      LANE_PRIOR_EVAL_REPORT_PATH,
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
      repoDir: "/tmp/repo",
      rawConfig: { ...config, awsRegion: "garage" },
      runCommand: async (_command, options) => {
        calls.push({ env: options.env });
        return "";
      },
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
