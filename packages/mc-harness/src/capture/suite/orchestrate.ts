import path from "node:path";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { MC_DIR } from "#protocol/paths.ts";
import { exportMedia } from "#src/capture/export.ts";
import { renderMedia } from "#src/capture/media.ts";
import { verifyLiveFixtureClass, withLiveFixture } from "./csi.ts";
import {
  retainFixture,
  restoreFixture,
  verifyFixturePatches,
} from "./fixture.ts";
import { retainRuntime, restoreRuntime } from "./runtime.ts";
import { verifyRuntimeInputs } from "./runtime-sources.ts";
import { localSession } from "./session.ts";
import { executeScenario } from "./execute.ts";
import {
  defineCaptureSuite,
  SuiteSchema,
  selectScenarios,
  type CaptureSuite,
  type SuiteScenario,
} from "./define.ts";
import {
  archiveCapture,
  retainSuiteRun,
  readSuiteRun,
  restoreCapture,
  retainedSuiteFile,
  relativeSuiteFile,
} from "./archive.ts";
import { command } from "./process.ts";
import type { BlobStore } from "./store.ts";
import { localRollout } from "./rollout.ts";
import { syncEmbeds } from "./embeds.ts";
import { SuiteRunSchema } from "./archive.ts";
import { awsStore } from "./aws-store.ts";
import { publishLegacy } from "./legacy.ts";
import { runScenarioSessions } from "./sessions.ts";
import { phase } from "./progress.ts";

export async function loadSuite(file: string): Promise<CaptureSuite> {
  const imported: unknown = await import(pathToFileURL(file).href);
  return defineCaptureSuite(
    z.object({ default: SuiteSchema }).parse(imported).default,
  );
}
export type SuiteOptions = {
  repoRoot: string;
  suiteFile: string;
  runtime: string;
  fixture?: string | undefined;
  scenario?: string | undefined;
  shot?: string | undefined;
};

async function runtimeRoot(
  options: SuiteOptions & { store: BlobStore },
  directory: string,
  cache: string,
) {
  if (options.runtime === "worktree") {
    await command([
      "mise",
      "exec",
      "--",
      "gradle",
      "-p",
      path.join(options.repoRoot, "packages/the-storm/plugin"),
      ":dist:assemble",
      ":bridge:assemble",
      "--console=plain",
    ]);
    await command([
      "mise",
      "exec",
      "--",
      "gradle",
      "-p",
      path.join(options.repoRoot, "packages/the-storm/client"),
      "assemble",
      "--console=plain",
    ]);
    const hash = await retainRuntime(options.repoRoot, options.store);
    const sourceDirectory = await restoreRuntime(
      options.repoRoot,
      options.store,
      { cache, runtimeHash: hash, destination: path.join(directory, "source") },
    );
    return { sourceDirectory, hash };
  }
  const match = /^saved:([a-f0-9-]{36})$/u.exec(options.runtime);
  if (match?.[1] === undefined)
    throw new Error("Runtime must be worktree or saved:<run-id>");
  const previous = await readSuiteRun(options.store, cache, match[1]);
  const sourceDirectory = await restoreRuntime(
    options.repoRoot,
    options.store,
    {
      cache,
      runtimeHash: previous.runtime,
      destination: path.join(directory, "source"),
    },
  );
  return { sourceDirectory, hash: previous.runtime };
}

/** Refresh by default; an explicit content-addressed fixture reuses verified terrain. */
export async function runSuite(options: SuiteOptions) {
  const id = randomUUID(),
    directory = path.join(MC_DIR, "suites", id),
    cache = path.join(MC_DIR, "suite-blobs");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const suite = await loadSuite(options.suiteFile);
  relativeSuiteFile(options.repoRoot, options.suiteFile);
  selectScenarios(suite, options);
  if (options.runtime === "worktree")
    await verifyRuntimeInputs(options.repoRoot, options.suiteFile);
  if (options.fixture === undefined) await verifyLiveFixtureClass();
  const store = awsStore("the-storm-capture-fixtures");
  const runtime = await phase("build/restore runtime", () =>
    runtimeRoot({ ...options, store }, directory, cache),
  );
  const recordedSuite = await loadSuite(
    path.join(
      runtime.sourceDirectory,
      path.relative(options.repoRoot, options.suiteFile),
    ),
  );
  selectScenarios(recordedSuite, options);
  const fixture =
    options.fixture === undefined
      ? await withLiveFixture(options.repoRoot, (source) =>
          retainFixture(source, recordedSuite.patches, store),
        )
      : z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .parse(options.fixture);
  await verifyFixturePatches(store, cache, fixture, recordedSuite.patches);
  return dispatchCapture({
    ...options,
    store,
    directory,
    cache,
    id,
    fixture,
    runtime,
  });
}

export type CaptureOptions = Omit<SuiteOptions, "runtime"> & {
  store: BlobStore;
  directory: string;
  cache: string;
  id: string;
  fixture: string;
  runtime: { sourceDirectory: string; hash: string };
  rolloutSnapshot?: string | null | undefined;
};

async function dispatchCapture(options: CaptureOptions) {
  const { store: _store, ...request } = options;
  const file = path.join(options.directory, "request.json");
  await Bun.write(file, JSON.stringify(request), { mode: 0o600 });
  await command(
    [
      "bun",
      path.join(
        options.runtime.sourceDirectory,
        "packages/mc-harness/src/capture/suite/worker.ts",
      ),
      file,
    ],
    undefined,
    {
      cwd: options.runtime.sourceDirectory,
      progress: true,
      env: { TOOLKIT_MC_DIRECTORY: path.join(options.directory, "harness") },
    },
  );
  return SuiteRunSchema.parse(
    await Bun.file(path.join(options.directory, "run.json")).json(),
  );
}
async function startRollout(options: CaptureOptions, suite: CaptureSuite) {
  const source =
    options.rolloutSnapshot === undefined ? suite.rollout : undefined;
  const snapshot = options.rolloutSnapshot ?? undefined;
  if (source === undefined && snapshot === undefined) return;
  return localRollout({
    store: options.store,
    cache: options.cache,
    ...(source === undefined ? {} : { source }),
    ...(snapshot === undefined ? {} : { snapshot }),
  });
}
export async function captureSuite(options: CaptureOptions) {
  const suiteFile = path.join(
    options.runtime.sourceDirectory,
    path.relative(options.repoRoot, options.suiteFile),
  );
  const suite = await loadSuite(suiteFile),
    selected = selectScenarios(suite, options);
  const first = selected[0];
  if (first === undefined) throw new Error("Empty suite");
  const mapDirectory = path.join(options.directory, "world");
  await phase("restore terrain", () =>
    restoreFixture(options.store, options.cache, options.fixture, mapDirectory),
  );
  const helpers = [
    ...new Set(
      selected.filter((s) => s.isolation !== "fresh").flatMap((s) => s.helpers),
    ),
  ];
  const rollout = await startRollout(options, suite);
  const docsPublic = path.join(options.repoRoot, "packages/ts-mc-docs/public");
  const startSession = (scenario: SuiteScenario) =>
    phase(`start server for ${scenario.id}`, () =>
      localSession({
        mapDirectory,
        sourceDirectory: options.runtime.sourceDirectory,
        spawn: suite.bootstrap,
        helpers: scenario.isolation === "fresh" ? scenario.helpers : helpers,
        features: [
          ...new Set([...(suite.features ?? []), ...(scenario.features ?? [])]),
        ],
        ...(rollout === undefined ? {} : { rollout: rollout.bootstrap }),
      }),
    );
  try {
    const results = await runScenarioSessions(
      selected,
      startSession,
      (scenario, session) =>
        phase(
          `scenario ${(selected.indexOf(scenario) + 1).toString()}/${selected.length.toString()}: ${scenario.id}`,
          () =>
            executeScenario({
              scenario,
              suiteFile,
              target: session.target,
              account: "XiguaJerred",
              docsPublic,
              publish: false,
              ...(scenario.isolation === "fresh"
                ? { ownedFreshTarget: session.target }
                : {}),
              ...(options.shot === undefined ? {} : { shot: options.shot }),
            }),
        ),
    );
    const scenarios = [];
    for (const result of results)
      scenarios.push({
        id: result.scenario,
        archive: await phase(`retain ${result.scenario}`, () =>
          archiveCapture(options.store, result.run),
        ),
      });
    const rolloutHash = rollout === undefined ? null : await rollout.retain();
    const selection = {
      ...(options.scenario === undefined ? {} : { scenario: options.scenario }),
      ...(options.shot === undefined ? {} : { shot: options.shot }),
    };
    const run = {
      schema: 1 as const,
      id: options.id,
      suite: suite.id,
      suiteFile: relativeSuiteFile(options.repoRoot, options.suiteFile),
      fixture: options.fixture,
      runtime: options.runtime.hash,
      rollout: rolloutHash,
      selection,
      scenarios,
    };
    await retainSuiteRun(options.store, run);
    for (const result of results)
      await phase(`publish ${result.scenario}`, () =>
        exportMedia(result.run, result.rendered, docsPublic),
      );
    await publishLegacy(
      suite.legacyOutputs ?? [],
      results.flatMap((result) => result.shots),
      docsPublic,
      path.join(options.directory, "legacy-before"),
    );
    await syncEmbeds(
      options.repoRoot,
      results.flatMap((result) => result.shots),
    );
    await Bun.write(
      path.join(options.directory, "run.json"),
      JSON.stringify(run, null, 2),
    );
    return run;
  } finally {
    await rollout?.stop();
  }
}

export async function replaySuite(
  options: Omit<SuiteOptions, "runtime" | "suiteFile">,
  runId: string,
) {
  const cache = path.join(MC_DIR, "suite-blobs");
  const store = awsStore("the-storm-capture-fixtures");
  const previous = await readSuiteRun(store, cache, runId);
  const id = randomUUID(),
    directory = path.join(MC_DIR, "suites", id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const sourceDirectory = await restoreRuntime(options.repoRoot, store, {
    cache,
    runtimeHash: previous.runtime,
    destination: path.join(directory, "source"),
  });
  const selection =
    options.scenario === undefined && options.shot === undefined
      ? previous.selection
      : {};
  const recordedSuite = await loadSuite(
    path.join(sourceDirectory, previous.suiteFile),
  );
  if (
    recordedSuite.id !== previous.suite ||
    selectScenarios(recordedSuite, { ...options, ...selection }).some(
      (s) => !previous.scenarios.some((original) => original.id === s.id),
    )
  )
    throw new Error("Replay selection is outside the retained suite run");
  return dispatchCapture({
    ...options,
    suiteFile: retainedSuiteFile(options.repoRoot, previous),
    store,
    ...selection,
    directory,
    cache,
    id,
    fixture: previous.fixture,
    runtime: { sourceDirectory, hash: previous.runtime },
    rolloutSnapshot: previous.rollout,
  });
}

export async function renderSuite(
  options: Omit<SuiteOptions, "runtime" | "suiteFile">,
  runId: string,
): Promise<void> {
  const store = awsStore("the-storm-capture-fixtures");
  const cache = path.join(MC_DIR, "suite-blobs"),
    run = await readSuiteRun(store, cache, runId);
  const suite = await loadSuite(retainedSuiteFile(options.repoRoot, run));
  if (suite.id !== run.suite)
    throw new Error("Render suite identity differs from the retained run");
  const selected = selectScenarios(suite, options).filter(
    (s) =>
      options.scenario !== undefined ||
      options.shot !== undefined ||
      run.scenarios.some((original) => original.id === s.id),
  );
  for (const scenario of selected) {
    const original = run.scenarios.find((s) => s.id === scenario.id);
    if (original === undefined)
      throw new Error(`Run lacks scenario ${scenario.id}`);
    const directory = path.join(MC_DIR, "suites", randomUUID());
    const capture = await restoreCapture(store, {
      cache,
      archive: original.archive,
      destination: directory,
    });
    capture.captures = capture.captures.filter(
      (c) => options.shot === undefined || c.name === options.shot,
    );
    if (capture.captures.length === 0)
      throw new Error(
        `Run lacks raw frames for ${options.shot ?? scenario.id}`,
      );
    const rendered = path.join(directory, "rendered");
    await mkdir(rendered);
    for (const c of capture.captures) {
      const presentation = scenario.shots.find((p) => p.name === c.name);
      if (presentation === undefined)
        throw new Error(`Missing presentation ${c.name}`);
      await Bun.write(c.presentation, JSON.stringify(presentation));
      await renderMedia(c.source, c.presentation, path.join(rendered, c.name));
    }
    await exportMedia(
      capture,
      rendered,
      path.join(options.repoRoot, "packages/ts-mc-docs/public"),
    );
    await publishLegacy(
      suite.legacyOutputs ?? [],
      capture.captures.map((c) => c.name),
      path.join(options.repoRoot, "packages/ts-mc-docs/public"),
      path.join(directory, "legacy-before"),
    );
    await syncEmbeds(
      options.repoRoot,
      capture.captures.map((c) => c.name),
    );
  }
}
