import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MC_DIR } from "#protocol/paths.ts";
import { RunSchema, initializeRun } from "#src/capture/model.ts";
import { runScene } from "#src/capture/runner.ts";
import { renderMedia, sha256 } from "#src/capture/media.ts";
import { exportMedia } from "#src/capture/export.ts";
import { presentScene, type SuiteScenario } from "./define.ts";

export async function executeScenario(input: {
  scenario: SuiteScenario;
  suiteFile: string;
  target: string;
  account: string;
  docsPublic: string;
  shot?: string;
  publish?: boolean;
}) {
  if (input.target === "live")
    throw new Error("Suite scenarios run only on disposable real-map servers");
  const scene = presentScene(input.scenario, input.shot);
  const anchor = input.scenario.anchor;
  const point = (offset: [number, number, number]) => ({
    x: anchor[0] + offset[0],
    y: anchor[1] + offset[1],
    z: anchor[2] + offset[2],
  });
  const id = `capture-${randomUUID()}`;
  const directory = path.join(MC_DIR, "captures", id);
  await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  const run = RunSchema.parse({
    schema: 1,
    id,
    target: input.target,
    name: input.account,
    reason: `Capture suite scenario ${input.scenario.id}`,
    scene: input.suiteFile,
    sceneHash: await sha256(input.suiteFile),
    box: {
      world: input.scenario.world,
      min: point(scene.bounds.min),
      max: point(scene.bounds.max),
    },
    anchor,
    state: "preflight",
    checkpoint: null,
    inspectors: scene.inspectors,
    baseline: null,
    server: null,
    snapshot: null,
    inspection: null,
    origin: null,
    staging: null,
    cleanup: [],
    captures: [],
    error: "",
  });
  await initializeRun(directory, run);
  await runScene(directory, scene, run);
  if (run.state !== "complete") throw new Error(`${run.id}: ${run.error}`);
  const expected = input.scenario.shots
    .filter((s) => input.shot === undefined || s.name === input.shot)
    .map((s) => s.name)
    .sort();
  if (
    JSON.stringify(expected) !==
    JSON.stringify(run.captures.map((c) => c.name).sort())
  )
    throw new Error(
      `Scenario ${input.scenario.id} did not emit its declared shots`,
    );
  const rendered = path.join(directory, "suite-render");
  await mkdir(rendered);
  for (const capture of run.captures)
    await renderMedia(
      capture.source,
      capture.presentation,
      path.join(rendered, capture.name),
    );
  const snippets =
    input.publish === false
      ? []
      : await exportMedia(run, rendered, input.docsPublic);
  return {
    id,
    scenario: input.scenario.id,
    snippets,
    shots: expected,
    run,
    rendered,
  };
}
