import {
  PrIdentitySchema,
  ReadinessEvidenceSchema,
  type PrIdentity,
  type ReadinessEvidence,
  type FleetSnapshot,
} from "@shepherdjerred/pr-fleet-controller/src/domain/schemas.ts";
import { RunRecorder } from "@shepherdjerred/pr-fleet-controller/src/bundle/run-recorder.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const emptyFleetSnapshot: FleetSnapshot = {
  open: 0,
  green: 0,
  active: 0,
  queued: 0,
  pending: 0,
  waiting: 0,
  paused: 0,
  prs: [],
};

export class TemporaryDirectoryOwner {
  readonly #directories: string[] = [];

  async create(prefix: string): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), prefix));
    this.#directories.push(directory);
    return directory;
  }

  own(directory: string): void {
    this.#directories.push(directory);
  }

  async cleanup(): Promise<void> {
    await Promise.all(
      this.#directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  }
}

export async function createRunRecorder(
  directories: TemporaryDirectoryOwner,
  prefix: string,
  secretValues: readonly string[] = [],
): Promise<RunRecorder> {
  const stateDirectory = await directories.create(prefix);
  return RunRecorder.create({
    stateDirectory,
    controllerVersion: "0.1.0",
    controllerCommit: "a".repeat(40),
    controllerSourceDirty: false,
    controllerSourceFingerprint: "b".repeat(64),
    model: "openai/gpt-5.6-terra",
    repository: "example/repository",
    checkout: "/tmp/checkout",
    worktreeRoot: "/tmp/worktrees",
    maxWorkers: 2,
    secretValues,
  });
}

export function identity(
  number: number,
  overrides: Partial<PrIdentity> = {},
): PrIdentity {
  return PrIdentitySchema.parse({
    number,
    title: `PR ${String(number)}`,
    url: `https://github.com/shepherdjerred/monorepo/pull/${String(number)}`,
    draft: false,
    author: "author",
    labels: [],
    headRefName: `feature/pr-${String(number)}`,
    headSha: String(number).padStart(40, "a").slice(-40),
    baseRefName: "main",
    crossRepository: false,
    maintainerCanModify: true,
    ...overrides,
  });
}

export function evidence(
  pr: PrIdentity,
  overrides: Partial<ReadinessEvidence> = {},
): ReadinessEvidence {
  return ReadinessEvidenceSchema.parse({
    headSha: pr.headSha,
    checks: [
      {
        name: "buildkite",
        state: "SUCCESS",
        bucket: "pass",
        link: "https://buildkite.com/sjerred/monorepo/builds/1",
        softFail: false,
      },
    ],
    buildkiteCurrentHead: true,
    buildkiteFailure: null,
    conflict: false,
    reviewFindings: [],
    hostedReviewComplete: true,
    hardFailureFingerprint: null,
    reviewFingerprint: null,
    ...overrides,
  });
}
