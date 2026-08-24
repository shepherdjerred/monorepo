#!/usr/bin/env bun

import { requireEnv } from "../../scripts/lib/run.ts";
import { asRecord } from "../../scripts/lib/json.ts";

const NATIVE_PR_STEP_KEYS = new Set([
  "quotabar-macos-pr",
  "tasknotes-native-pr",
]);
const ACTIVE_STATES = new Set(["assigned", "accepted", "running"]);
const TERMINAL_STATES = new Set([
  "passed",
  "failed",
  "canceled",
  "skipped",
  "broken",
  "timed_out",
]);

export const MAX_IDLE_DISPATCH_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 60_000;

export type NativeJob = {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly startedAt: string | null;
  readonly stepKey: string;
};

export type DispatchDecision =
  | { readonly kind: "complete" }
  | { readonly kind: "waiting"; readonly idleSinceMs: number | null }
  | { readonly kind: "timed-out"; readonly pending: readonly NativeJob[] };

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
    const state = requiredString(buildJob["state"], `${stepKey}.state`);
    const startedAt = nullableString(
      buildJob["started_at"],
      `${stepKey}.started_at`,
    );
    nativeJobs.push({ id, name, state, startedAt, stepKey });
  }
  return nativeJobs;
}

export function dispatchDecision(
  jobs: readonly NativeJob[],
  nowMs: number,
  idleSinceMs: number | null,
  maxIdleMs = MAX_IDLE_DISPATCH_MS,
): DispatchDecision {
  const pending = jobs.filter(
    (job) => job.startedAt === null && !TERMINAL_STATES.has(job.state),
  );
  if (pending.length === 0) return { kind: "complete" };

  if (jobs.some((job) => ACTIVE_STATES.has(job.state))) {
    return { kind: "waiting", idleSinceMs: null };
  }

  const nextIdleSinceMs = idleSinceMs ?? nowMs;
  if (nowMs - nextIdleSinceMs >= maxIdleMs) {
    return { kind: "timed-out", pending };
  }
  return { kind: "waiting", idleSinceMs: nextIdleSinceMs };
}

async function fetchNativeJobs(): Promise<NativeJob[]> {
  const token = requireEnv("BUILDKITE_API_TOKEN");
  const organization = requireEnv("BUILDKITE_ORGANIZATION_SLUG");
  const pipeline = requireEnv("BUILDKITE_PIPELINE_SLUG");
  const buildNumber = requireEnv("BUILDKITE_BUILD_NUMBER");
  if (!/^\d+$/.test(buildNumber)) {
    throw new Error("BUILDKITE_BUILD_NUMBER must be an integer");
  }

  const response = await fetch(
    `https://api.buildkite.com/v2/organizations/${encodeURIComponent(organization)}/pipelines/${encodeURIComponent(pipeline)}/builds/${buildNumber}?include_retried_jobs=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Buildkite API returned ${response.status.toString()} while checking native dispatch`,
    );
  }
  const payload: unknown = await response.json();
  return parseNativeJobs(payload);
}

function stateSummary(jobs: readonly NativeJob[]): string {
  return jobs.map((job) => `${job.stepKey}=${job.state}`).join(", ");
}

async function main(): Promise<void> {
  let idleSinceMs: number | null = null;
  let previousSummary = "";
  let lastLogMs = 0;

  for (;;) {
    const jobs = await fetchNativeJobs();
    if (jobs.length === 0) {
      throw new Error("No selected native PR jobs were present in this build");
    }

    const nowMs = Date.now();
    const summary = stateSummary(jobs);
    if (
      summary !== previousSummary ||
      nowMs - lastLogMs >= HEARTBEAT_INTERVAL_MS
    ) {
      console.log(`macOS native dispatch: ${summary}`);
      previousSummary = summary;
      lastLogMs = nowMs;
    }

    const decision = dispatchDecision(jobs, nowMs, idleSinceMs);
    if (decision.kind === "complete") {
      console.log("Every selected native PR job was dispatched or completed");
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
