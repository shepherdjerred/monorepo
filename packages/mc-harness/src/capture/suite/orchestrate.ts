import path from "node:path";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { MC_DIR } from "#protocol/paths.ts";
import { exportMedia } from "#src/capture/export.ts";
import { renderMedia } from "#src/capture/media.ts";
import { withLiveFixture } from "./csi.ts";
import { retainFixture, restoreFixture } from "./fixture.ts";
import { retainRuntime, restoreRuntime } from "./runtime.ts";
import { localSession } from "./session.ts";
import { executeScenario } from "./execute.ts";
import { SuiteSchema, selectScenarios, type CaptureSuite } from "./define.ts";
import { archiveCapture, retainSuiteRun, readSuiteRun, restoreCapture } from "./archive.ts";
import { command } from "./process.ts";
import type { BlobStore } from "./store.ts";
import { localRollout } from "./rollout.ts";
import { syncEmbeds } from "./embeds.ts";

export async function loadSuite(file: string): Promise<CaptureSuite> {
  const imported: unknown = await import(pathToFileURL(file).href);
  return z.object({default: SuiteSchema}).parse(imported).default;
}
export type SuiteOptions = {repoRoot: string; suiteFile: string; store: BlobStore; runtime: string; scenario?: string | undefined; shot?: string | undefined};

async function runtimeRoot(options: SuiteOptions, directory: string, cache: string) {
  if (options.runtime === "worktree") {
    await command(["mise", "exec", "--", "gradle", "-p", path.join(options.repoRoot, "packages/the-storm/plugin"), ":dist:assemble", ":bridge:assemble", "--console=plain"]);
    await command(["mise", "exec", "--", "gradle", "-p", path.join(options.repoRoot, "packages/the-storm/client"), "assemble", "--console=plain"]);
    return {sourceDirectory: options.repoRoot, hash: await retainRuntime(options.repoRoot, options.store)};
  }
  const match = /^saved:([a-f0-9-]{36})$/u.exec(options.runtime);
  if (match?.[1] === undefined) throw new Error("Runtime must be worktree or saved:<run-id>");
  const previous = await readSuiteRun(options.store, cache, match[1]);
  const sourceDirectory = await restoreRuntime(options.repoRoot, options.store, {cache, runtimeHash: previous.runtime, destination: path.join(directory, "source")});
  return {sourceDirectory, hash: previous.runtime};
}

/** Refresh is mandatory here; replay has an explicit separate entry point. */
export async function runSuite(options: SuiteOptions) {
  const id = randomUUID(), directory = path.join(MC_DIR, "suites", id), cache = path.join(MC_DIR, "suite-blobs");
  await mkdir(directory, {recursive: true, mode: 0o700});
  const suite = await loadSuite(options.suiteFile);
  selectScenarios(suite, options);
  const fixture = await withLiveFixture(options.repoRoot, source => retainFixture(source, suite.patches, options.store));
  const runtime = await runtimeRoot(options, directory, cache);
  return captureSuite({...options, directory, cache, id, fixture, runtime});
}

type CaptureOptions = Omit<SuiteOptions, "runtime"> & {directory: string; cache: string; id: string; fixture: string; runtime: {sourceDirectory: string; hash: string}; rolloutSnapshot?: string | null};
async function startRollout(options: CaptureOptions, suite: CaptureSuite) {
  const source = options.rolloutSnapshot === undefined ? suite.rollout : undefined;
  const snapshot = options.rolloutSnapshot ?? undefined;
  if (source === undefined && snapshot === undefined) return;
  return localRollout({store: options.store, cache: options.cache,
    ...(source === undefined ? {} : {source}), ...(snapshot === undefined ? {} : {snapshot})});
}
async function captureSuite(options: CaptureOptions) {
  const suiteFile = path.join(options.runtime.sourceDirectory, path.relative(options.repoRoot, options.suiteFile));
  const suite = await loadSuite(suiteFile), selected = selectScenarios(suite, options);
  const first = selected[0];
  if (first === undefined) throw new Error("Empty suite");
  const mapDirectory = path.join(options.directory, "world");
  await restoreFixture(options.store, options.cache, options.fixture, mapDirectory);
  const helpers = [...new Set(selected.flatMap(s => s.helpers))];
  const rollout = await startRollout(options, suite);
  let session: Awaited<ReturnType<typeof localSession>> | undefined;
  const results = [];
  const docsPublic = path.join(options.repoRoot, "packages/ts-mc-docs/public");
  try {
    session = await localSession({mapDirectory, sourceDirectory: options.runtime.sourceDirectory, spawn: [68.5, 69, 66.5], helpers,
      ...(suite.features === undefined ? {} : {features: suite.features}),
      ...(rollout === undefined ? {} : {rollout: rollout.bootstrap})});
    for (const scenario of selected) {
      await session.prepare(scenario);
      results.push(await executeScenario({scenario, suiteFile, target: session.target, account: "XiguaJerred", docsPublic,
        publish: false, ...(options.shot === undefined ? {} : {shot: options.shot})}));
    }
    const scenarios = [];
    for (const result of results) scenarios.push({id: result.scenario, archive: await archiveCapture(options.store, result.run)});
    const rolloutHash = rollout === undefined ? null : await rollout.retain();
    const selection = {...(options.scenario === undefined ? {} : {scenario: options.scenario}), ...(options.shot === undefined ? {} : {shot: options.shot})};
    const run = {schema: 1 as const, id: options.id, suite: suite.id, fixture: options.fixture, runtime: options.runtime.hash, rollout: rolloutHash, selection, scenarios};
    await retainSuiteRun(options.store, run);
    for (const result of results) await exportMedia(result.run, result.rendered, docsPublic);
    await syncEmbeds(options.repoRoot, results.flatMap(result => result.shots));
    await Bun.write(path.join(options.directory, "run.json"), JSON.stringify(run, null, 2));
    return run;
  } finally {
    try { await session?.stop(); } finally { await rollout?.stop(); }
  }
}

export async function replaySuite(options: Omit<SuiteOptions, "runtime">, runId: string) {
  const cache = path.join(MC_DIR, "suite-blobs");
  const previous = await readSuiteRun(options.store, cache, runId);
  const id = randomUUID(), directory = path.join(MC_DIR, "suites", id);
  await mkdir(directory, {recursive: true, mode: 0o700});
  const sourceDirectory = await restoreRuntime(options.repoRoot, options.store, {cache, runtimeHash: previous.runtime, destination: path.join(directory, "source")});
  const selection = options.scenario === undefined && options.shot === undefined ? previous.selection : {};
  return captureSuite({...options, ...selection, directory, cache, id, fixture: previous.fixture, runtime: {sourceDirectory, hash: previous.runtime}, rolloutSnapshot: previous.rollout});
}

export async function renderSuite(options: Omit<SuiteOptions, "runtime">, runId: string): Promise<void> {
  const cache = path.join(MC_DIR, "suite-blobs"), run = await readSuiteRun(options.store, cache, runId);
  const suite = await loadSuite(options.suiteFile);
  const selected = selectScenarios(suite, options).filter(s => options.scenario !== undefined || options.shot !== undefined || run.scenarios.some(original => original.id === s.id));
  for (const scenario of selected) {
    const original = run.scenarios.find(s => s.id === scenario.id);
    if (original === undefined) throw new Error(`Run lacks scenario ${scenario.id}`);
    const directory = path.join(MC_DIR, "suites", randomUUID());
    const capture = await restoreCapture(options.store, {cache, archive: original.archive, destination: directory});
    capture.captures = capture.captures.filter(c => options.shot === undefined || c.name === options.shot);
    const rendered = path.join(directory, "rendered");
    await mkdir(rendered);
    for (const c of capture.captures) {
      const presentation = scenario.shots.find(p => p.name === c.name);
      if (presentation === undefined) throw new Error(`Missing presentation ${c.name}`);
      await Bun.write(c.presentation, JSON.stringify(presentation));
      await renderMedia(c.source, c.presentation, path.join(rendered, c.name));
    }
    await exportMedia(capture, rendered, path.join(options.repoRoot, "packages/ts-mc-docs/public"));
    await syncEmbeds(options.repoRoot, capture.captures.map(c => c.name));
  }
}
