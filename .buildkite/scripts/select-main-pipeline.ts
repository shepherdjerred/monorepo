#!/usr/bin/env bun

import { fixedCorpusMode } from "./migration-core.ts";

type UnknownRecord = Record<string, unknown>;
type PipelineStep = UnknownRecord;
type PipelineDocument = {
  readonly agents: unknown;
  readonly env: unknown;
  readonly steps: readonly PipelineStep[];
};

const STEP_LANE_REQUIREMENTS: Readonly<Record<string, readonly string[]>> = {
  verify: [],
  "alert-dashboard-sqlite": [],
  "release-please": [],
  "build-summary": [],
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

/**
 * `--replace` swaps the not-yet-started remainder of the build for the steps
 * uploaded, rather than appending them (`buildkite-agent` v3.134: "Replace the
 * rest of the existing pipeline with the steps uploaded. Jobs that are already
 * running are not removed").
 *
 * On the default branch `upload-pipeline.sh` uploads only `main-bootstrap.yml`,
 * so the build holds just the selector step when this runs and either mode
 * would schedule the same graph the first time. Replace is what makes a
 * REPEATED upload safe: if `ci-selector-base` is retried, a second run uploads
 * the same graph over the first instead of scheduling every step twice.
 * `ci-selector-base` is itself running at that point, so it is never removed
 * and the `depends_on` every rendered step carries stays resolvable — the
 * dependency shape is pinned by "renders stable selector dependencies and no
 * duplicate keys".
 */
export function pipelineUploadArguments(
  changedFilesPath: string | undefined,
): string[] {
  const argumentsList = ["buildkite-agent", "pipeline", "upload", "--replace"];
  if (changedFilesPath !== undefined) {
    argumentsList.push("--changed-files-path", changedFilesPath);
  }
  return argumentsList;
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

export async function writeSelectorChangedFiles(base: string): Promise<string> {
  const child = Bun.spawn(
    ["git", "diff", "--no-renames", "--name-only", base, "HEAD"],
    { stdout: "pipe", stderr: "inherit" },
  );
  const changedFiles = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`selector changed-file diff exited ${exitCode.toString()}`);
  }
  const temporaryRoot = (Bun.env["TMPDIR"] ?? "/tmp").replace(/\/+$/u, "");
  const path = `${temporaryRoot}/buildkite-main-changed-files.${crypto.randomUUID()}.txt`;
  await Bun.write(path, changedFiles);
  return path;
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

async function uploadPipeline(
  document: PipelineDocument,
  steps: readonly PipelineStep[],
  changedFilesPath: string | undefined,
): Promise<void> {
  const payload = pipelinePayload(document, steps, Bun.env);
  const child = Bun.spawn(pipelineUploadArguments(changedFilesPath), {
    stdin: new Blob([payload]),
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0)
    throw new Error(`pipeline upload failed with ${exitCode.toString()}`);
}

export const SELECTED_STEPS_METADATA_KEY = "ci-selected-main-steps";

/**
 * Publish the uploaded step keys so `annotate-build-summary.ts` knows which
 * steps exist in this build. Without it the annotator queries every step in
 * `summarySteps`, and `buildkite-agent step get` exits nonzero for a step the
 * selector omitted, failing the summary job on an otherwise green build. The
 * fallback path clears it back to empty: it uploads the complete graph, so
 * every step exists.
 *
 * Call this BEFORE the upload it describes. Buildkite appends uploaded steps,
 * so a failure after the graph is in the build cannot be retried and must not
 * fail the build; writing first means a failed write still falls back to the
 * complete graph. Every caller therefore records the set it is about to
 * upload, and the value never outlives the attempt that wrote it.
 */
async function recordSelectedSteps(
  selected: ReadonlySet<string>,
): Promise<void> {
  const child = Bun.spawn(
    [
      "buildkite-agent",
      "meta-data",
      "set",
      SELECTED_STEPS_METADATA_KEY,
      [...selected].sort().join("\n"),
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(
      `could not record selected main steps (exit ${exitCode.toString()})`,
    );
  }
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
  let steps: Map<string, PipelineStep> | undefined;
  let changedFilesPath: string | undefined;
  let uploaded = false;

  try {
    steps = mainSteps(document);
    assertSelectionContract(steps);
    const base = await prepareBase();
    changedFilesPath = await writeSelectorChangedFiles(base);
    const decisions = await selectLanes(base);
    const selected = selectedKeys(steps, decisions);
    const rendered = renderSteps(steps, selected);
    validateRenderedSteps(rendered);
    // Record the selection BEFORE uploading. Buildkite appends uploaded steps,
    // so once the graph is in the build no later step may fail: recording
    // afterwards let a transient metadata write turn an already-runnable build
    // into a hard failure. Recording first also keeps the metadata a truthful
    // description of what gets uploaded, because a failure here still falls
    // back to the complete graph.
    await recordSelectedSteps(selected);
    await uploadPipeline(document, rendered, changedFilesPath);
    uploaded = true;
    console.log(`Uploaded ${selected.size.toString()} selected main CI steps`);
    return 0;
  } catch (error) {
    // Uploading a DIFFERENT graph after one already landed is unsafe even
    // under `--replace`: replace drops only steps that have not started, so
    // any selected step already running would survive and the complete graph
    // would schedule its own copy alongside. Past that point the failure has
    // to surface rather than fall back.
    if (uploaded) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`WARN: ${reason}; falling back to the complete main graph`);
    const rendered = renderFallbackSteps(document, steps, changedFilesPath);
    validateRenderedSteps(rendered);
    // Clear any selection the failed attempt recorded: an empty value is how
    // the summary learns the complete graph was uploaded and every step
    // exists. Best-effort, and deliberately not allowed to abort the fallback:
    // this path exists to get a graph into the build when selection failed, so
    // a metadata write must never be what leaves main with no steps at all. A
    // stale value only mislabels rows in the summary annotation.
    try {
      await recordSelectedSteps(new Set());
    } catch (clearError) {
      const detail =
        clearError instanceof Error ? clearError.message : String(clearError);
      console.error(`WARN: could not clear the recorded selection: ${detail}`);
    }
    await uploadPipeline(document, rendered, changedFilesPath);
    await annotateFallback(reason);
    return 0;
  } finally {
    if (changedFilesPath !== undefined) {
      // Best-effort by design. This runs after the upload, and a throw from
      // `finally` replaces the outcome of the block it follows — so a failed
      // unlink of a scratch file would exit nonzero on a build whose steps are
      // already scheduled, which is exactly the hard failure the upload
      // ordering above exists to prevent. The file lives in the agent's
      // temporary directory and is reclaimed with the workspace.
      try {
        await Bun.file(changedFilesPath).delete();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`WARN: could not delete ${changedFilesPath}: ${reason}`);
      }
    }
  }
}

if (import.meta.main) process.exitCode = await main();
