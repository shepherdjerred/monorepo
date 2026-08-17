#!/usr/bin/env bun

import { asRecord } from "../../scripts/lib/json.ts";

import { writeJsonHandoff } from "./buildkite-handoff.ts";
import {
  readHandoffValue,
  readRequiredMetadata,
  requiredArgument,
} from "./read-buildkite-handoff.ts";

const COMMIT_PATTERN = /^[a-f\d]{40}$/iu;
const HANDOFF_KEY = "homelab-release-admission";
const HANDOFF_ARTIFACT = "homelab-release-admission.json";

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
  return {
    schema: "homelab-release-admission/v1",
    outcome:
      input.buildCommit === input.currentMainCommit ? "admitted" : "superseded",
    ...input,
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
  return {
    schema,
    outcome,
    buildCommit,
    currentMainCommit,
    buildNumber: exactBuildNumber,
  };
}

export function parseOriginMainLsRemote(output: string): string {
  const lines = output.trim().split("\n");
  if (lines.length !== 1) {
    throw new Error(
      "origin/main resolution returned an unexpected number of refs",
    );
  }
  const [commit, ref, ...extra] = lines[0]?.split("\t") ?? [];
  if (
    commit === undefined ||
    ref !== "refs/heads/main" ||
    extra.length > 0 ||
    !COMMIT_PATTERN.test(commit)
  ) {
    throw new Error("could not resolve the exact origin/main commit");
  }
  return commit;
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
  runner: CommandRunner = runCommand,
): Promise<string> {
  const result = await runner([
    "git",
    "ls-remote",
    "--exit-code",
    "origin",
    "refs/heads/main",
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `could not resolve origin/main for homelab release admission (exit ${result.exitCode.toString()})`,
    );
  }
  return parseOriginMainLsRemote(result.stdout);
}

function requiredEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for homelab release admission`);
  }
  return value;
}

async function admit(): Promise<void> {
  if (requiredEnvironment("BUILDKITE_BRANCH") !== "main") {
    throw new Error("homelab release admission only supports main builds");
  }
  const buildNumber = Number(requiredEnvironment("BUILDKITE_BUILD_NUMBER"));
  const admission = decideHomelabReleaseAdmission({
    buildCommit: requiredEnvironment("BUILDKITE_COMMIT"),
    currentMainCommit: await resolveOriginMainCommit(),
    buildNumber,
  });
  await writeJsonHandoff(HANDOFF_KEY, HANDOFF_ARTIFACT, admission);
  console.log(
    `homelab release ${admission.outcome}: build ${admission.buildCommit}, current main ${admission.currentMainCommit}`,
  );
}

async function consume(): Promise<void> {
  const raw = await readHandoffValue(await readRequiredMetadata(HANDOFF_KEY));
  const admission = parseHomelabReleaseAdmission(JSON.parse(raw));
  console.log(admission.outcome);
}

async function main(): Promise<void> {
  const command = requiredArgument(
    Bun.argv,
    2,
    "homelab release admission command",
  );
  switch (command) {
    case "admit":
      await admit();
      return;
    case "consume":
      await consume();
      return;
    default:
      throw new Error(`unknown homelab release admission command: ${command}`);
  }
}

if (import.meta.main) await main();
