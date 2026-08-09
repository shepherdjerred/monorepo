#!/usr/bin/env bun

import {
  FixedCorpusConfigurationError,
  fixedCorpusMode,
} from "./migration-core.ts";

type UnknownRecord = Record<string, unknown>;
type PipelineStep = UnknownRecord;
type PipelineDocument = {
  readonly agents: unknown;
  readonly env: unknown;
  readonly steps: readonly PipelineStep[];
};

const ALWAYS_SELECTED = new Set(["verify", "release-please", "build-summary"]);

const STEP_LANE_REQUIREMENTS: Readonly<Record<string, readonly string[]>> = {
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
  "argocd-sync": ["helm", "argocd", "images"],
  "tofu-cloudflare": ["tofu", "argocd"],
  "scout-beta-release": ["site-scout", "images"],
  "scout-prod-reconcile": ["scout-reconcile"],
  "version-commit-back": ["images"],
};

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

function isMainStep(step: PipelineStep): boolean {
  const key = step["key"];
  if (typeof key === "string" && ALWAYS_SELECTED.has(key)) return true;
  const condition = step["if"];
  return (
    typeof condition === "string" &&
    condition.includes("build.branch == pipeline.default_branch")
  );
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

function assertSelectionContract(
  steps: ReadonlyMap<string, PipelineStep>,
): void {
  for (const key of steps.keys()) {
    if (ALWAYS_SELECTED.has(key)) continue;
    if (STEP_LANE_REQUIREMENTS[key] !== undefined) continue;
    throw new Error(`main step ${key} has no dynamic-selection contract`);
  }
}

async function runCommand(
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

async function prepareBase(): Promise<string> {
  const exitCode = await runCommand([
    "bun",
    "--no-install",
    ".buildkite/scripts/prepare-ci-changed-base.ts",
  ]);
  if (exitCode !== 0) throw new Error("main CI base selection failed");
  const result = Bun.spawn(
    ["buildkite-agent", "meta-data", "get", "ci-changed-base"],
    { stdout: "pipe", stderr: "inherit" },
  );
  const baseText = await new Response(result.stdout).text();
  const base = baseText.trim();
  const metadataExitCode = await result.exited;
  if (metadataExitCode !== 0 || base.length === 0) {
    throw new Error("main CI base metadata is unavailable");
  }
  return base;
}

async function selectLanes(base: string): Promise<Map<string, boolean>> {
  const decisions = new Map<string, boolean>();
  for (const lane of SELECTOR_LANES) {
    const exitCode = await runCommand(
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
  if (selected.has("scout-beta-release")) selected.add("scout-tag-release");

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

async function uploadPipeline(
  document: PipelineDocument,
  steps: readonly PipelineStep[],
): Promise<void> {
  const payload = JSON.stringify({
    agents: document.agents,
    env: document.env,
    steps,
  });
  const child = Bun.spawn(
    ["buildkite-agent", "pipeline", "upload", "--replace"],
    { stdin: new Blob([payload]), stdout: "inherit", stderr: "inherit" },
  );
  const exitCode = await child.exited;
  if (exitCode !== 0)
    throw new Error(`pipeline upload failed with ${exitCode.toString()}`);
}

async function annotateFallback(reason: string): Promise<void> {
  const child = Bun.spawn(
    [
      "buildkite-agent",
      "annotate",
      "--style",
      "warning",
      "--context",
      "ci-selector",
      `Main CI selection failed open; uploaded the complete graph. ${reason}`,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await child.exited) !== 0) {
    console.error("WARN: could not annotate main CI selector fallback");
  }
}

async function main(): Promise<number> {
  fixedCorpusMode(Bun.env);
  const document = parsePipeline(
    await Bun.file(".buildkite/pipeline.yml").text(),
  );
  const steps = mainSteps(document);
  assertSelectionContract(steps);

  try {
    const base = await prepareBase();
    const decisions = await selectLanes(base);
    const selected = selectedKeys(steps, decisions);
    const rendered = renderSteps(steps, selected);
    validateRenderedSteps(rendered);
    await uploadPipeline(document, rendered);
    console.log(`Uploaded ${selected.size.toString()} selected main CI steps`);
    return 0;
  } catch (error) {
    if (error instanceof FixedCorpusConfigurationError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`WARN: ${reason}; falling back to the complete main graph`);
    const rendered = renderSteps(steps, new Set(steps.keys()));
    validateRenderedSteps(rendered);
    await uploadPipeline(document, rendered);
    await annotateFallback(reason);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main();
