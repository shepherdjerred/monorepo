#!/usr/bin/env bun

import {
  parsePipeline,
  pipelinePayload,
  type PipelineDocument,
  type PipelineStep,
} from "../selectors/select-main-pipeline.ts";
import { asRecord } from "../../../scripts/lib/json.ts";

const MAIN_ONLY = /^\s*build\.branch\s*==\s*pipeline\.default_branch\s*$/u;
const GLOBAL_SELECTOR_INPUTS = new Set([
  ".buildkite/pipeline.yml",
  ".buildkite/scripts/images/image-targets.ts",
  ".buildkite/scripts/macos/macos-native-selection.ts",
  ".buildkite/scripts/migration-core.ts",
  ".buildkite/scripts/selectors/select-main-pipeline-io.ts",
  ".buildkite/scripts/selectors/select-main-pipeline-selection.ts",
  ".buildkite/scripts/selectors/select-main-pipeline.ts",
  ".buildkite/scripts/selection/select-pr-pipeline.ts",
  "scripts/ci-test-manifest.json",
  ".buildkite/scripts/selectors/tofu-lane-paths.ts",
  "scripts/lib/json.ts",
]);

/**
 * The review gate must never fail while another PR step is still running: a
 * failed job marks the build "failing", and Buildkite then cancels every
 * running `cancel_on_build_failing` sibling. The gate therefore declares
 * every other PR step as a dependency with `allow_dependency_failure`. Those
 * edges order the gate last; they are not inputs, so selection keeps only the
 * ones that are already selected instead of scheduling every lane on every PR.
 * (The step key stays `codex-review-gate` for dashboard continuity; the gate
 * itself is multi-provider since REVIEW_PROVIDERS.)
 */
export const REVIEW_GATE_KEY = "codex-review-gate";

function requiredString(value: unknown, description: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${description} must be a non-empty string`);
  }
  return value;
}

function stepKey(step: PipelineStep): string {
  return requiredString(step["key"], "pipeline step key");
}

function dependencyKeys(step: PipelineStep): string[] {
  const dependsOn = step["depends_on"];
  if (dependsOn === undefined) return [];
  if (typeof dependsOn === "string") return [dependsOn];
  if (!Array.isArray(dependsOn)) {
    throw new TypeError(`${stepKey(step)} has an unsupported depends_on shape`);
  }
  return dependsOn.map((dependency) =>
    requiredString(dependency, `${stepKey(step)} dependency`),
  );
}

function isMainOnly(step: PipelineStep): boolean {
  const condition = step["if"];
  return typeof condition === "string" && MAIN_ONLY.test(condition);
}

function stringList(value: unknown, description: string): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) {
    throw new TypeError(`${description} must be a string or string array`);
  }
  return value.map((entry) => requiredString(entry, description));
}

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => new Bun.Glob(pattern).match(path));
}

export function changedStep(
  step: PipelineStep,
  changedPaths: readonly string[],
): boolean {
  const raw = step["if_changed"];
  if (raw === undefined) return true;
  if (typeof raw === "string") {
    return changedPaths.some((path) => matchesAny(path, [raw]));
  }
  const record = asRecord(raw);
  if (record === null) {
    throw new TypeError(`${stepKey(step)} has an unsupported if_changed shape`);
  }
  const include = stringList(record["include"], `${stepKey(step)} include`);
  const excludeRaw = record["exclude"];
  const exclude =
    excludeRaw === undefined
      ? []
      : stringList(excludeRaw, `${stepKey(step)} exclude`);
  return changedPaths.some(
    (path) => matchesAny(path, include) && !matchesAny(path, exclude),
  );
}

function withoutNativeChangedFiles(step: PipelineStep): PipelineStep {
  const rendered = { ...step };
  delete rendered["if_changed"];
  return rendered;
}

export function selectPrSteps(
  document: PipelineDocument,
  changedPaths: readonly string[],
): PipelineStep[] {
  const available = availablePrSteps(document);
  assertReviewGateRunsLast(available);
  const selected = initiallySelectedKeys(available, changedPaths);
  addDependencyClosure(available, selected);
  return [...available]
    .filter(([key]) => selected.has(key))
    .map(([key, step]) =>
      key === REVIEW_GATE_KEY
        ? orderedAfterSelected(withoutNativeChangedFiles(step), selected)
        : withoutNativeChangedFiles(step),
    );
}

/**
 * Reject a pipeline where the review gate could run beside another PR step,
 * because a gate failure would then cancel that step.
 */
export function assertReviewGateRunsLast(
  available: ReadonlyMap<string, PipelineStep>,
): void {
  const gate = available.get(REVIEW_GATE_KEY);
  if (gate === undefined) {
    throw new Error(`PR pipeline is missing ${REVIEW_GATE_KEY}`);
  }
  if (gate["allow_dependency_failure"] !== true) {
    throw new Error(
      `${REVIEW_GATE_KEY} must set allow_dependency_failure: true so it still reports after another step fails`,
    );
  }
  if (gate["cancel_on_build_failing"] !== undefined) {
    throw new Error(`${REVIEW_GATE_KEY} must not set cancel_on_build_failing`);
  }
  assertGateSoftFailsOnlyOnQuota(gate["soft_fail"]);
  const dependencies = new Set(dependencyKeys(gate));
  const missing = [...available.keys()].filter(
    (key) => key !== REVIEW_GATE_KEY && !dependencies.has(key),
  );
  if (missing.length > 0) {
    throw new Error(
      `${REVIEW_GATE_KEY} must depend on every other PR step so its failure cannot cancel them; missing: ${missing.join(", ")}`,
    );
  }
}

/**
 * The gate may soft-fail on exactly one exit status: the one it exits with
 * when every enabled provider declared it could not review because of quota
 * (`REVIEW_GATE_BLOCKED_EXIT_CODE` in `@shepherdjerred/code-review`). Any
 * broader soft_fail would let real review findings, timeouts, or errors look
 * green, so everything else is rejected, including an absent soft_fail.
 */
export const REVIEW_GATE_QUOTA_EXIT_STATUS = 42;

function assertGateSoftFailsOnlyOnQuota(softFail: unknown): void {
  const expected = `soft_fail: [{ exit_status: ${String(REVIEW_GATE_QUOTA_EXIT_STATUS)} }]`;
  if (!Array.isArray(softFail) || softFail.length !== 1) {
    throw new Error(`${REVIEW_GATE_KEY} must set exactly ${expected}`);
  }
  const entry = asRecord(softFail[0]);
  if (
    entry === null ||
    Object.keys(entry).length !== 1 ||
    entry["exit_status"] !== REVIEW_GATE_QUOTA_EXIT_STATUS
  ) {
    throw new Error(`${REVIEW_GATE_KEY} must set exactly ${expected}`);
  }
}

function orderedAfterSelected(
  step: PipelineStep,
  selected: ReadonlySet<string>,
): PipelineStep {
  return {
    ...step,
    depends_on: dependencyKeys(step).filter((dependency) =>
      selected.has(dependency),
    ),
  };
}

function availablePrSteps(
  document: PipelineDocument,
): Map<string, PipelineStep> {
  const available = new Map<string, PipelineStep>();
  for (const step of document.steps) {
    if (isMainOnly(step)) continue;
    const key = stepKey(step);
    if (available.has(key)) throw new Error(`duplicate PR step key ${key}`);
    available.set(key, step);
  }
  return available;
}

function initiallySelectedKeys(
  available: ReadonlyMap<string, PipelineStep>,
  changedPaths: readonly string[],
): Set<string> {
  const selectAll = changedPaths.some((path) =>
    GLOBAL_SELECTOR_INPUTS.has(path),
  );
  const selected = new Set<string>();
  for (const [key, step] of available) {
    if (selectAll || changedStep(step, changedPaths)) selected.add(key);
  }
  return selected;
}

function addDependencyClosure(
  available: ReadonlyMap<string, PipelineStep>,
  selected: Set<string>,
): void {
  const pending = [...selected];
  while (pending.length > 0) {
    const key = pending.pop();
    if (key === undefined) continue;
    const step = available.get(key);
    if (step === undefined)
      throw new Error(`selected PR step ${key} is missing`);
    // The gate's edges only order it last; see REVIEW_GATE_KEY.
    if (key === REVIEW_GATE_KEY) continue;
    for (const dependency of dependencyKeys(step)) {
      if (!available.has(dependency)) {
        throw new Error(`${key} depends on unavailable PR step ${dependency}`);
      }
      if (!selected.has(dependency)) {
        selected.add(dependency);
        pending.push(dependency);
      }
    }
  }
}

async function main(): Promise<number> {
  const changedFilesPath = Bun.argv[2];
  if (changedFilesPath === undefined) {
    throw new Error("usage: select-pr-pipeline.ts <changed-files-path>");
  }
  const changedFilesSource = await Bun.file(changedFilesPath).text();
  const changedPaths = changedFilesSource
    .split("\n")
    .map((path) => path.trim())
    .filter((path) => path !== "");
  const repositoryRoot = new URL("../../..", import.meta.url).pathname;
  const document = parsePipeline(
    await Bun.file(`${repositoryRoot}/.buildkite/pipeline.yml`).text(),
  );
  const selected = selectPrSteps(document, changedPaths);
  const keys = selected
    .map((step) => stepKey(step))
    .sort((left, right) => left.localeCompare(right));
  const metadata = Bun.spawn(
    [
      "buildkite-agent",
      "meta-data",
      "set",
      "ci-selected-pr-steps",
      keys.join("\n"),
    ],
    { stdout: "inherit", stderr: "inherit", env: Bun.env },
  );
  if ((await metadata.exited) !== 0) {
    throw new Error("could not record selected PR steps");
  }
  const payload = pipelinePayload(document, selected, Bun.env);
  const upload = Bun.spawn(
    [
      "buildkite-agent",
      "pipeline",
      "upload",
      "--changed-files-path",
      changedFilesPath,
    ],
    {
      stdin: new Blob([payload]),
      stdout: "inherit",
      stderr: "inherit",
      env: Bun.env,
    },
  );
  if ((await upload.exited) !== 0) throw new Error("PR pipeline upload failed");
  console.log(`Uploaded ${keys.length.toString()} selected PR CI steps`);
  return 0;
}

if (import.meta.main) process.exitCode = await main();
