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
  ".buildkite/scripts/image-targets.ts",
  ".buildkite/scripts/macos-native-selection.ts",
  ".buildkite/scripts/migration-core.ts",
  ".buildkite/scripts/select-main-pipeline-io.ts",
  ".buildkite/scripts/select-main-pipeline-selection.ts",
  ".buildkite/scripts/select-main-pipeline.ts",
  ".buildkite/scripts/selection/select-pr-pipeline.ts",
  ".buildkite/scripts/tofu-lane-paths.ts",
  "scripts/lib/json.ts",
]);

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
  const selected = initiallySelectedKeys(available, changedPaths);
  addDependencyClosure(available, selected);
  return [...available]
    .filter(([key]) => selected.has(key))
    .map(([, step]) => withoutNativeChangedFiles(step));
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
