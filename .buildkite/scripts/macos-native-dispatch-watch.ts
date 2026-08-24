#!/usr/bin/env bun

import { requireEnv } from "../../scripts/lib/run.ts";
import { asRecord } from "../../scripts/lib/json.ts";

const NATIVE_PR_STEP_KEYS = new Set([
  "quotabar-macos-pr",
  "tasknotes-native-pr",
]);
const ALL_NATIVE_STEP_KEYS = new Set([
  ...NATIVE_PR_STEP_KEYS,
  "quotabar-macos-main",
  "tasknotes-native-main",
]);
const ACTIVE_STATES = new Set(["running"]);
const SUCCESS_STATES = new Set(["passed", "skipped"]);

export const MAX_IDLE_DISPATCH_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 60_000;

export type NativeJob = {
  readonly id: string;
  readonly name: string;
  readonly retried: boolean;
  readonly state: string;
  readonly startedAt: string | null;
  readonly stepKey: string;
};

export type RunningNativeJob = {
  readonly buildNumber: number;
  readonly name: string;
  readonly stepKey: string;
};

export type DispatchDecision =
  | { readonly kind: "complete" }
  | { readonly kind: "waiting"; readonly idleSinceMs: number | null }
  | { readonly kind: "timed-out"; readonly pending: readonly NativeJob[] };

export type DispatchContext = {
  readonly idleSinceMs: number | null;
  readonly maxIdleMs?: number;
  readonly nowMs: number;
  readonly otherBuildRunning?: boolean;
};

function requiredString(value: unknown, description: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${description} must be a string`);
  }
  return value;
}

function nullableString(value: unknown, description: string): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value, description);
}

function requiredBoolean(value: unknown, description: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${description} must be a boolean`);
  }
  return value;
}

export function parseNativeJobs(value: unknown): NativeJob[] {
  const build = asRecord(value);
  const jobs = build?.["jobs"];
  if (!Array.isArray(jobs)) {
    throw new TypeError("Buildkite build response must contain a jobs array");
  }

  const nativeJobs: NativeJob[] = [];
  for (const valueJob of jobs) {
    const buildJob = asRecord(valueJob);
    if (buildJob === null) continue;
    const stepKey = buildJob["step_key"];
    if (typeof stepKey !== "string" || !NATIVE_PR_STEP_KEYS.has(stepKey)) {
      continue;
    }

    const id = requiredString(buildJob["id"], `${stepKey}.id`);
    const name = requiredString(buildJob["name"], `${stepKey}.name`);
    const retried = requiredBoolean(buildJob["retried"], `${stepKey}.retried`);
    const state = requiredString(buildJob["state"], `${stepKey}.state`);
    const startedAt = nullableString(
      buildJob["started_at"],
      `${stepKey}.started_at`,
    );
    nativeJobs.push({ id, name, retried, state, startedAt, stepKey });
  }
  return nativeJobs;
}

export function parseOtherRunningNativeJobs(
  value: unknown,
  currentBuildNumber: number,
): RunningNativeJob[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Buildkite running-build response must be an array");
  }

  const running: RunningNativeJob[] = [];
  for (const valueBuild of value) {
    const build = asRecord(valueBuild);
    if (build === null) {
      throw new TypeError("Buildkite running build must be an object");
    }
    const buildNumber = build["number"];
    const jobs = build["jobs"];
    if (typeof buildNumber !== "number" || !Array.isArray(jobs)) {
      throw new TypeError("Buildkite running build is malformed");
    }
    if (buildNumber === currentBuildNumber) continue;

    for (const valueJob of jobs) {
      const buildJob = asRecord(valueJob);
      if (buildJob === null) continue;
      const stepKey = buildJob["step_key"];
      if (
        typeof stepKey !== "string" ||
        !ALL_NATIVE_STEP_KEYS.has(stepKey) ||
        buildJob["state"] !== "running"
      ) {
        continue;
      }
      running.push({
        buildNumber,
        name: requiredString(buildJob["name"], `${stepKey}.name`),
        stepKey,
      });
    }
  }
  return running;
}

function currentAttempts(jobs: readonly NativeJob[]): {
  readonly attempts: readonly NativeJob[];
  readonly awaitingRetry: readonly NativeJob[];
} {
  const attempts: NativeJob[] = [];
  const awaitingRetry: NativeJob[] = [];
  const stepKeys = new Set(jobs.map((job) => job.stepKey));
  for (const stepKey of stepKeys) {
    const jobsForStep = jobs.filter((job) => job.stepKey === stepKey);
    const current = jobsForStep.filter((job) => !job.retried);
    if (current.length > 1) {
      throw new Error(
        `Buildkite returned multiple current attempts for ${stepKey}`,
      );
    }
    const attempt = current[0];
    if (attempt === undefined) {
      const previous = jobsForStep.at(-1);
      if (previous !== undefined) awaitingRetry.push(previous);
    } else {
      attempts.push(attempt);
    }
  }
  return { attempts, awaitingRetry };
}

export function dispatchDecision(
  jobs: readonly NativeJob[],
  context: DispatchContext,
): DispatchDecision {
  const maxIdleMs = context.maxIdleMs ?? MAX_IDLE_DISPATCH_MS;
  const { attempts, awaitingRetry } = currentAttempts(jobs);
  const pending = [
    ...attempts.filter((job) => !SUCCESS_STATES.has(job.state)),
    ...awaitingRetry,
  ];
  if (pending.length === 0) return { kind: "complete" };

  if (
    context.otherBuildRunning === true ||
    attempts.some((job) => ACTIVE_STATES.has(job.state))
  ) {
    return { kind: "waiting", idleSinceMs: null };
  }

  const nextIdleSinceMs = context.idleSinceMs ?? context.nowMs;
  if (context.nowMs - nextIdleSinceMs >= maxIdleMs) {
    return { kind: "timed-out", pending };
  }
  return { kind: "waiting", idleSinceMs: nextIdleSinceMs };
}

async function fetchJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(
      `Buildkite API returned ${response.status.toString()} while checking native dispatch`,
    );
  }
  const payload: unknown = await response.json();
  return payload;
}

async function fetchDispatchState(): Promise<{
  readonly jobs: readonly NativeJob[];
  readonly otherRunning: readonly RunningNativeJob[];
}> {
  const token = requireEnv("BUILDKITE_API_TOKEN");
  const organization = requireEnv("BUILDKITE_ORGANIZATION_SLUG");
  const pipeline = requireEnv("BUILDKITE_PIPELINE_SLUG");
  const buildNumber = requireEnv("BUILDKITE_BUILD_NUMBER");
  if (!/^\d+$/.test(buildNumber)) {
    throw new Error("BUILDKITE_BUILD_NUMBER must be an integer");
  }
  const baseUrl =
    `https://api.buildkite.com/v2/organizations/${encodeURIComponent(organization)}` +
    `/pipelines/${encodeURIComponent(pipeline)}/builds`;
  const [build, runningBuilds] = await Promise.all([
    fetchJson(`${baseUrl}/${buildNumber}?include_retried_jobs=true`, token),
    fetchJson(
      `${baseUrl}?state=running&per_page=50&include_retried_jobs=true`,
      token,
    ),
  ]);
  return {
    jobs: parseNativeJobs(build),
    otherRunning: parseOtherRunningNativeJobs(
      runningBuilds,
      Number(buildNumber),
    ),
  };
}

function stateSummary(
  jobs: readonly NativeJob[],
  otherRunning: readonly RunningNativeJob[],
): string {
  const own = jobs
    .map(
      (job) => `${job.stepKey}=${job.state}${job.retried ? "(retried)" : ""}`,
    )
    .join(", ");
  const external = otherRunning
    .map((job) => `#${job.buildNumber.toString()}/${job.stepKey}`)
    .join(", ");
  return external.length === 0 ? own : `${own}; running elsewhere: ${external}`;
}

async function main(): Promise<void> {
  let idleSinceMs: number | null = null;
  let previousSummary = "";
  let lastLogMs = 0;

  for (;;) {
    const { jobs, otherRunning } = await fetchDispatchState();
    if (jobs.length === 0) {
      throw new Error("No selected native PR jobs were present in this build");
    }

    const nowMs = Date.now();
    const summary = stateSummary(jobs, otherRunning);
    if (
      summary !== previousSummary ||
      nowMs - lastLogMs >= HEARTBEAT_INTERVAL_MS
    ) {
      console.log(`macOS native dispatch: ${summary}`);
      previousSummary = summary;
      lastLogMs = nowMs;
    }

    const decision = dispatchDecision(jobs, {
      idleSinceMs,
      nowMs,
      otherBuildRunning: otherRunning.length > 0,
    });
    if (decision.kind === "complete") {
      console.log("Every selected native PR job reached final success");
      return;
    }
    if (decision.kind === "timed-out") {
      const pending = decision.pending
        .map((job) => `${job.name} (${job.state})`)
        .join(", ");
      throw new Error(
        `No macOS job dispatched for 5 minutes; pending: ${pending}. Wake and log in to the macOS Buildkite host, then retry the jobs.`,
      );
    }
    idleSinceMs = decision.idleSinceMs;
    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

if (import.meta.main) await main();
