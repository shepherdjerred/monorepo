/**
 * Homelab release admission: the decision, without the I/O.
 *
 * Extracted so the Buildkite entry point and the Woodpecker one share one
 * implementation during the migration. Only the transport differs between
 * them -- which build metadata store the verdict is published to -- and the
 * rule about which build may release must not be allowed to drift between the
 * two while both exist.
 */

import { asRecord } from "../json.ts";

/** Handoff key the verdict is published under. */
export const HOMELAB_RELEASE_ADMISSION_KEY = "homelab-release-admission";

const COMMIT_PATTERN = /^[a-f\d]{40}$/iu;

export type HomelabReleaseAdmission = {
  readonly schema: "homelab-release-admission/v1";
  readonly outcome: "admitted" | "superseded";
  readonly buildCommit: string;
  readonly currentMainCommit: string;
  readonly buildNumber: number;
};

function positiveSafeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("build number must be a positive safe integer");
  }
  return value;
}

function validatedInput(input: {
  readonly buildCommit: string;
  readonly currentMainCommit: string;
  readonly buildNumber: number;
}): void {
  if (
    !COMMIT_PATTERN.test(input.buildCommit) ||
    !COMMIT_PATTERN.test(input.currentMainCommit)
  ) {
    throw new Error("invalid homelab release admission input");
  }
  positiveSafeInteger(input.buildNumber);
}

export function decideHomelabReleaseAdmission(input: {
  readonly buildCommit: string;
  readonly currentMainCommit: string;
  readonly buildNumber: number;
}): HomelabReleaseAdmission {
  validatedInput(input);
  const buildCommit = input.buildCommit.toLowerCase();
  const currentMainCommit = input.currentMainCommit.toLowerCase();
  return {
    schema: "homelab-release-admission/v1",
    outcome: buildCommit === currentMainCommit ? "admitted" : "superseded",
    buildCommit,
    currentMainCommit,
    buildNumber: input.buildNumber,
  };
}

export function parseHomelabReleaseAdmission(
  value: unknown,
): HomelabReleaseAdmission {
  const record = asRecord(value);
  const schema = record?.["schema"];
  const outcome = record?.["outcome"];
  const buildCommit = record?.["buildCommit"];
  const currentMainCommit = record?.["currentMainCommit"];
  const buildNumber = record?.["buildNumber"];
  if (
    typeof buildCommit !== "string" ||
    typeof currentMainCommit !== "string" ||
    schema !== "homelab-release-admission/v1" ||
    (outcome !== "admitted" && outcome !== "superseded")
  ) {
    throw new Error("invalid homelab release admission handoff");
  }
  const exactBuildNumber = positiveSafeInteger(buildNumber);
  validatedInput({
    buildCommit,
    currentMainCommit,
    buildNumber: exactBuildNumber,
  });
  const canonicalBuildCommit = buildCommit.toLowerCase();
  const canonicalCurrentMainCommit = currentMainCommit.toLowerCase();
  return {
    schema,
    outcome,
    buildCommit: canonicalBuildCommit,
    currentMainCommit: canonicalCurrentMainCommit,
    buildNumber: exactBuildNumber,
  };
}

export function parseOriginMainLsRemote(
  output: string,
  branchName = "main",
): string {
  const expectedRef = `refs/heads/${branchName}`;
  const lines = output.trim().split("\n");
  if (lines.length !== 1) {
    throw new Error(
      `origin/${branchName} resolution returned an unexpected number of refs`,
    );
  }
  const [commit, ref, ...extra] = lines[0]?.split("\t") ?? [];
  if (
    commit === undefined ||
    ref !== expectedRef ||
    extra.length > 0 ||
    !COMMIT_PATTERN.test(commit)
  ) {
    throw new Error(`could not resolve the exact origin/${branchName} commit`);
  }
  return commit.toLowerCase();
}

type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

export type CommandRunner = (
  argumentsList: readonly string[],
) => Promise<CommandResult>;

async function runCommand(
  argumentsList: readonly string[],
): Promise<CommandResult> {
  const child = Bun.spawn([...argumentsList], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  return { exitCode, stdout };
}

export async function resolveOriginMainCommit(
  branchName = "main",
  runner: CommandRunner = runCommand,
): Promise<string> {
  const result = await runner([
    "git",
    "ls-remote",
    "--exit-code",
    "origin",
    `refs/heads/${branchName}`,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `could not resolve origin/${branchName} for homelab release admission (exit ${result.exitCode.toString()})`,
    );
  }
  return parseOriginMainLsRemote(result.stdout, branchName);
}
