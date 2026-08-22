#!/usr/bin/env bun

import { fixedCorpusMode } from "./migration-core.ts";
import {
  runSelection as runSelectionForMain,
  type SelectionDependencies,
} from "./select-main-pipeline-selection.ts";

type UnknownRecord = Record<string, unknown>;
export type PipelineStep = UnknownRecord;
export type PipelineDocument = {
  readonly agents: unknown;
  readonly env: unknown;
  readonly steps: readonly PipelineStep[];
};

export async function runSelection(
  document: PipelineDocument,
  dependencies?: SelectionDependencies,
): Promise<number> {
  return runSelectionForMain(
    document,
    dependencies ?? {
      prepareBase,
      writeChangedFiles: writeSelectorChangedFiles,
      selectLanes,
      recordSelectedSteps,
      uploadPipeline,
      annotateFallback,
      deleteChangedFiles: async (path) => {
        try {
          await Bun.file(path).delete();
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : String(error);
          console.error(`WARN: could not delete ${path}: ${reason}`);
        }
      },
    },
  );
}

const STEP_LANE_REQUIREMENTS: Readonly<Record<string, readonly string[]>> = {
  verify: [],
  "alert-dashboard-sqlite": [],
  "release-please": [],
  "build-summary": [],
  "homelab-release-admission": [],
  "playwright-e2e-main": ["playwright"],
  "resume-build-main": ["resume"],
  "docker-e2e-main": ["docker-e2e"],
  images: ["images"],
  sites: ["sites"],
  publish: ["npm", "cooklang"],
  "ci-base-refresh": ["ci-base"],
  "ci-playwright-refresh": ["ci-playwright"],
  "helm-push": ["helm", "argocd", "images"],
  "tofu-apply": ["tofu"],
  "tofu-github": ["tofu"],
  "tofu-platform": ["tofu"],
  "argocd-sync": ["helm", "argocd", "images"],
  "tofu-cloudflare": ["tofu", "argocd"],
  "scout-beta-release": ["site-scout", "images"],
  "scout-tag-release": ["site-scout", "images"],
  "scout-prod-reconcile": ["scout-reconcile"],
  "version-commit-back": ["images"],
};

const ALWAYS_SELECTED = new Set(
  Object.entries(STEP_LANE_REQUIREMENTS)
    .filter(([, lanes]) => lanes.length === 0)
    .map(([key]) => key),
);

const SELECTOR_LANES = [
  ...new Set(Object.values(STEP_LANE_REQUIREMENTS).flat()),
];

function parseRecord(value: unknown, description: string): UnknownRecord {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${description} must be an object`);
  }
  const record: UnknownRecord = {};
  for (const [key, child] of Object.entries(value)) record[key] = child;
  return record;
}

function requiredString(value: unknown, description: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${description} must be a non-empty string`);
  }
  return value;
}

function stepKey(step: PipelineStep): string {
  return requiredString(step["key"], "pipeline step key");
}

export function parsePipeline(source: string): PipelineDocument {
  const parsed: unknown = Bun.YAML.parse(source);
  const document = parseRecord(parsed, "pipeline");
  if (!Array.isArray(document["steps"]))
    throw new Error("pipeline.yml must contain a steps array");
  const steps: PipelineStep[] = [];
  for (const value of document["steps"]) {
    steps.push(parseRecord(value, "pipeline step"));
  }
  return {
    agents: document["agents"],
    env: document["env"],
    steps,
  };
}

/**
 * Buildkite treats the spacing in an `if:` expression as insignificant, so a
 * step reformatted to `build.branch==pipeline.default_branch` still runs on
 * main. Matching the exact substring would drop that step from `mainSteps()`,
 * which hides it from `assertSelectionContract` and leaves it out of every
 * upload — the step would silently stop running on main.
 */
const MAIN_BRANCH_CONDITION =
  /\bbuild\.branch\s*==\s*pipeline\.default_branch\b/u;

function isMainStep(step: PipelineStep): boolean {
  const key = step["key"];
  if (typeof key === "string" && ALWAYS_SELECTED.has(key)) return true;
  const condition = step["if"];
  return typeof condition === "string" && MAIN_BRANCH_CONDITION.test(condition);
}

function dependencyKeys(step: PipelineStep): string[] {
  const dependsOn = step["depends_on"];
  if (dependsOn === undefined) return [];
  if (typeof dependsOn === "string") return [dependsOn];
  if (!Array.isArray(dependsOn)) {
    throw new TypeError(`${stepKey(step)} has an unsupported depends_on shape`);
  }
  const dependencies: string[] = [];
  for (const dependency of dependsOn) {
    dependencies.push(
      requiredString(dependency, `${stepKey(step)} dependency`),
    );
  }
  return dependencies;
}

function withDependency(step: PipelineStep, dependency: string): PipelineStep {
  const dependencies = dependencyKeys(step);
  if (!dependencies.includes(dependency)) dependencies.unshift(dependency);
  return { ...step, depends_on: dependencies };
}

export function mainSteps(
  document: PipelineDocument,
): Map<string, PipelineStep> {
  const result = new Map<string, PipelineStep>();
  for (const step of document.steps) {
    const key = stepKey(step);
    if (key === "ci-selector-base") continue;
    if (!isMainStep(step)) continue;
    if (result.has(key)) throw new Error(`duplicate main step key ${key}`);
    result.set(key, step);
  }
  return result;
}

export function assertSelectionContract(
  steps: ReadonlyMap<string, PipelineStep>,
): void {
  for (const key of steps.keys()) {
    if (STEP_LANE_REQUIREMENTS[key] !== undefined) continue;
    throw new Error(`main step ${key} has no dynamic-selection contract`);
  }
}

export async function runCommand(
  command: readonly string[],
  environment: Readonly<Record<string, string>> = {},
): Promise<number> {
  const child = Bun.spawn([...command], {
    env: { ...processEnv(), ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (stdout.length > 0) await Bun.stdout.write(stdout);
  if (stderr.length > 0) await Bun.stderr.write(stderr);
  return exitCode;
}

function processEnv(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export function pipelinePayload(
  document: PipelineDocument,
  steps: readonly PipelineStep[],
  environment: Readonly<Record<string, string | undefined>>,
): string {
  let payload = JSON.stringify({
    agents: document.agents,
    env: document.env,
    steps,
  });
  for (const name of ["CI_BASE_IMAGE", "CI_PLAYWRIGHT_IMAGE"]) {
    const placeholder = "$" + `{${name}}`;
    const encodedPlaceholder = JSON.stringify(placeholder);
    if (!payload.includes(encodedPlaceholder)) continue;
    const reference = requiredString(environment[name], name);
    payload = payload.replaceAll(encodedPlaceholder, JSON.stringify(reference));
  }
  return payload;
}

/** Upload the selected graph with `--replace`, making selector retries safe. */
export function pipelineUploadArguments(
  changedFilesPath: string | undefined,
): string[] {
  const argumentsList = ["buildkite-agent", "pipeline", "upload", "--replace"];
  if (changedFilesPath !== undefined) {
    argumentsList.push("--changed-files-path", changedFilesPath);
  }
  return argumentsList;
}

type BaseMetadataReader = () => Promise<{
  readonly text: string;
  readonly exitCode: number;
}>;

type ChangedFilesReader = (base: string) => Promise<{
  readonly text: string;
  readonly exitCode: number;
}>;

export async function prepareBase(
  run: typeof runCommand = runCommand,
  readMetadata: BaseMetadataReader = async () => {
    const result = Bun.spawn(
      ["buildkite-agent", "meta-data", "get", "ci-changed-base"],
      { stdout: "pipe", stderr: "inherit", env: processEnv() },
    );
    return {
      text: await new Response(result.stdout).text(),
      exitCode: await result.exited,
    };
  },
): Promise<string> {
  const exitCode = await run([
    "bun",
    "--no-install",
    ".buildkite/scripts/prepare-ci-changed-base.ts",
  ]);
  if (exitCode !== 0) throw new Error("main CI base selection failed");
  const metadata = await readMetadata();
  const base = metadata.text.trim();
  const metadataExitCode = metadata.exitCode;
  if (metadataExitCode !== 0 || base.length === 0) {
    throw new Error("main CI base metadata is unavailable");
  }
  return base;
}

export async function writeSelectorChangedFiles(
  base: string,
  readDiff: ChangedFilesReader = async (diffBase) => {
    const result = Bun.spawn(
      ["git", "diff", "--no-renames", "--name-only", diffBase, "HEAD"],
      { stdout: "pipe", stderr: "inherit", env: processEnv() },
    );
    return {
      text: await new Response(result.stdout).text(),
      exitCode: await result.exited,
    };
  },
): Promise<string> {
  const diff = await readDiff(base);
  const changedFiles = diff.text;
  const exitCode = diff.exitCode;
  if (exitCode !== 0) {
    throw new Error(`selector changed-file diff exited ${exitCode.toString()}`);
  }
  const temporaryRoot = (Bun.env["TMPDIR"] ?? "/tmp").replace(/\/+$/u, "");
  const path = `${temporaryRoot}/buildkite-main-changed-files.${crypto.randomUUID()}.txt`;
  await Bun.write(path, changedFiles);
  return path;
}

export async function selectLanes(
  base: string,
  run: typeof runCommand = runCommand,
): Promise<Map<string, boolean>> {
  const decisions = new Map<string, boolean>();
  for (const lane of SELECTOR_LANES) {
    const exitCode = await run(
      ["bun", "--no-install", ".buildkite/scripts/ci-changed.ts", lane],
      { CI_CHANGED_BASE: base },
    );
    if (exitCode !== 0 && exitCode !== 78) {
      throw new Error(`CI selector failed for lane ${lane}`);
    }
    decisions.set(lane, exitCode === 0);
  }
  return decisions;
}

export function selectedKeys(
  steps: ReadonlyMap<string, PipelineStep>,
  decisions: ReadonlyMap<string, boolean>,
): Set<string> {
  const selected = new Set<string>(ALWAYS_SELECTED);
  for (const [key, lanes] of Object.entries(STEP_LANE_REQUIREMENTS)) {
    if (lanes.some((lane) => decisions.get(lane) === true)) selected.add(key);
  }

  const pending = [...selected];
  while (pending.length > 0) {
    const key = pending.pop();
    if (key === undefined || key === "build-summary") continue;
    const step = steps.get(key);
    if (step === undefined) throw new Error(`selected step ${key} is missing`);
    for (const dependency of dependencyKeys(step)) {
      if (dependency === "ci-selector-base") continue;
      if (!steps.has(dependency)) {
        throw new Error(`${key} depends on missing main step ${dependency}`);
      }
      if (!selected.has(dependency)) {
        selected.add(dependency);
        pending.push(dependency);
      }
    }
  }
  return selected;
}

export function renderSteps(
  steps: ReadonlyMap<string, PipelineStep>,
  selected: ReadonlySet<string>,
): PipelineStep[] {
  const rendered: PipelineStep[] = [];
  for (const [key, original] of steps) {
    if (!selected.has(key)) continue;
    let step = withDependency(original, "ci-selector-base");
    if (key === "build-summary") {
      const summaryDependencies = dependencyKeys(original).filter(
        (dependency) => selected.has(dependency),
      );
      step = {
        ...step,
        depends_on: ["ci-selector-base", ...summaryDependencies],
      };
    }
    rendered.push(step);
  }
  return rendered;
}

function withoutNativeChangedFiles(step: PipelineStep): PipelineStep {
  const copy = { ...step };
  delete copy["if_changed"];
  return copy;
}

export function renderFallbackSteps(
  document: PipelineDocument,
  steps: ReadonlyMap<string, PipelineStep> | undefined,
  changedFilesPath: string | undefined,
): PipelineStep[] {
  const complete =
    steps === undefined
      ? [...document.steps]
      : renderSteps(steps, new Set(steps.keys()));
  return changedFilesPath === undefined
    ? complete.map((step) => withoutNativeChangedFiles(step))
    : complete;
}

export function validateRenderedSteps(rendered: readonly PipelineStep[]): void {
  const keys = new Set<string>();
  for (const step of rendered) {
    const key = stepKey(step);
    if (keys.has(key))
      throw new Error(`duplicate rendered main step key ${key}`);
    keys.add(key);
  }
  keys.add("ci-selector-base");
  for (const step of rendered) {
    for (const dependency of dependencyKeys(step)) {
      if (!keys.has(dependency)) {
        throw new Error(
          `${stepKey(step)} has missing rendered dependency ${dependency}`,
        );
      }
    }
  }
}

type PipelineUploader = (
  command: readonly string[],
  payload: string,
) => Promise<number>;

export async function uploadPipeline(
  document: PipelineDocument,
  steps: readonly PipelineStep[],
  changedFilesPath: string | undefined,
  upload: PipelineUploader = async (command, payload) => {
    const child = Bun.spawn([...command], {
      stdin: new Blob([payload]),
      stdout: "inherit",
      stderr: "inherit",
      env: processEnv(),
    });
    return child.exited;
  },
): Promise<void> {
  const payload = pipelinePayload(document, steps, Bun.env);
  const exitCode = await upload(
    pipelineUploadArguments(changedFilesPath),
    payload,
  );
  if (exitCode !== 0)
    throw new Error(`pipeline upload failed with ${exitCode.toString()}`);
}

export const SELECTED_STEPS_METADATA_KEY = "ci-selected-main-steps";

/** Record selected keys before upload so summary annotation has a truthful graph. */
type MetadataWriter = (command: readonly string[]) => Promise<number>;

export async function recordSelectedSteps(
  selected: ReadonlySet<string>,
  writeMetadata: MetadataWriter = async (command) => {
    const child = Bun.spawn([...command], {
      stdout: "inherit",
      stderr: "inherit",
      env: processEnv(),
    });
    return child.exited;
  },
): Promise<void> {
  const exitCode = await writeMetadata([
    "buildkite-agent",
    "meta-data",
    "set",
    SELECTED_STEPS_METADATA_KEY,
    [...selected].sort().join("\n"),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `could not record selected main steps (exit ${exitCode.toString()})`,
    );
  }
}

type FallbackAnnotator = (command: readonly string[]) => Promise<number>;

export async function annotateFallback(
  reason: string,
  annotate: FallbackAnnotator = async (command) => {
    const child = Bun.spawn([...command], {
      stdout: "inherit",
      stderr: "inherit",
      env: processEnv(),
    });
    return child.exited;
  },
): Promise<void> {
  const exitCode = await annotate([
    "buildkite-agent",
    "annotate",
    "--style",
    "warning",
    "--context",
    "ci-selector",
    `Main CI selection failed open; uploaded the complete graph. ${reason}`,
  ]);
  if (exitCode !== 0) {
    console.error("WARN: could not annotate main CI selector fallback");
  }
}

async function main(): Promise<number> {
  fixedCorpusMode(Bun.env);
  const document = parsePipeline(
    await Bun.file(".buildkite/pipeline.yml").text(),
  );
  return runSelection(document);
}

if (import.meta.main) process.exitCode = await main();
