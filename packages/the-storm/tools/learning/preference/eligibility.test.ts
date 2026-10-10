import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluationSchedule } from "#learning/evaluation-gate.ts";
import { unitMaps } from "#learning/maps/test-support.ts";
import { reviewEligibility } from "./eligibility.ts";
import { PilotLedger } from "#learning/pilot-ledger.ts";
import { digestFile, jsonText, sha } from "./ledger.ts";

// Text stand-ins check artifact binding. Dataset.load has independent Python
// tests; this boundary mock never produces footage or a trained/accepted model.
const datasetBoundary = vi.hoisted(() => ({ fingerprint: "" }));
vi.mock("./media.ts", () => ({
  run: () =>
    Promise.resolve(
      JSON.stringify({ dataset_sha256: datasetBoundary.fingerprint }),
    ),
}));
let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(
    path.join(os.tmpdir(), "rwf-review-eligibility-unit-"),
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

type Changes = {
  candidate?: number;
  failSeed?: number;
  reusedMatches?: boolean;
  wrongRuntime?: boolean;
  overlap?: boolean;
  wrongMaps?: boolean;
};
async function fixture(changes: Changes = {}) {
  const pilot = path.join(directory, "pilot");
  const evaluation = path.join(directory, "evaluation");
  const model = path.join(directory, "model");
  const dataset = path.join(directory, "dataset");
  for (const folder of [evaluation, model, dataset]) await mkdir(folder);
  const datasetFiles = [];
  for (const file of [
    "manifest.json",
    "train.jsonl",
    "validation.jsonl",
    "test.jsonl",
  ]) {
    await writeFile(path.join(dataset, file), `unit dataset boundary ${file}`);
    datasetFiles.push({
      file,
      sha256: await digestFile(path.join(dataset, file)),
    });
  }
  datasetBoundary.fingerprint = await digestFile(
    path.join(dataset, "manifest.json"),
  );
  const native = {
    hashes: [],
    engine: "Paper",
    controllerHz: 20,
    timeoutTicks: 1200,
    runtime: { unit: true },
  };
  const inputs = {
    native,
    maps: unitMaps,
    dataset: datasetFiles,
    bunVersion: "unit",
    platform: "darwin",
    arch: "arm64",
  };
  const ledger = await PilotLedger.create(pilot, {
    version: 1,
    mode: "pilot",
    acceptance: "unaccepted",
    device: "mps",
    dataset,
    inputSha256: sha(jsonText(inputs)),
    seeds: [11, 12, 13],
    seconds: 28_800,
  });
  await writeFile(path.join(pilot, "inputs.json"), jsonText(inputs));
  const actors = [];
  const manifests = [];
  for (let index = 0; index < 3; index++) {
    const seed = 11 + index;
    const checkpoint = path.join(
      pilot,
      `seed-${index.toString()}/learning/final`,
    );
    await mkdir(checkpoint, { recursive: true });
    const weights = `unit fixture weights ${seed.toString()}, not a model`;
    const manifest = {
      kind: "rwf-trooper-ppo",
      acceptance: "unaccepted",
      weights_sha256: sha(weights),
      training: {
        seed,
        dataset_sha256: datasetBoundary.fingerprint,
        provenance: "human-bc-plus-paper-ppo",
        test_used_for_selection: false,
        pilot_acceptance_checked: false,
        curriculum: { complete: true },
        maps: unitMaps.maps,
        map_coverage_complete: true,
        games:
          index === 0 && changes.overlap === true
            ? [{ seed: 600_100_000 }]
            : [],
      },
    };
    manifests.push(manifest);
    await writeFile(path.join(checkpoint, "weights.pt"), weights);
    await writeFile(path.join(checkpoint, "manifest.json"), jsonText(manifest));
    const started = index * 28_800_000;
    await ledger.claim(index, started);
    await ledger.finish(index, {
      status: "frozen",
      completedMs: started + 100,
      weightsSha256: sha(weights),
      manifestSha256: sha(jsonText(manifest)),
    });
    actors.push({
      checkpoint,
      seed,
      weightsSha256: sha(weights),
      manifestSha256: sha(jsonText(manifest)),
    });
    const reportDir = path.join(
      evaluation,
      `seed-${index.toString()}/learning`,
    );
    await mkdir(reportDir, { recursive: true });
    await writeFile(
      path.join(reportDir, "report.json"),
      jsonText({
        version: 2,
        maps: unitMaps.maps,
        engine: "Paper",
        mode: "pilot",
        acceptance: "unaccepted",
        actor_seed: seed,
        weights_sha256: sha(weights),
        manifest_sha256: sha(jsonText(manifest)),
        optimized: false,
        retried_duels: 0,
        blind_preference_checked: false,
        pilot_acceptance_checked: false,
        games: evaluationSchedule(200, 500_000_000, unitMaps.maps).map(
          (match, game) => ({
            ...match,
            engine: "Paper",
            match: `00000000-0000-4000-8000-${(game + (changes.reusedMatches === true ? 0 : index * 400)).toString().padStart(12, "0")}`,
            result:
              game % 200 <
              (match.opponent === "basic"
                ? 160
                : changes.failSeed === index
                  ? 119
                  : 120)
                ? "win"
                : "timeout",
            frames: 100,
            submitted_controls: 98,
            confirmed_controls: 95,
            applied_controls: 95,
            authored_fallbacks: 5,
            missed_ticks: 1,
            rejected_actions: 0,
            memory_resets: 1,
            dealt: 20,
            received: 8,
            seconds: 5,
            max_inference_ms: 2,
          }),
        ),
      }),
    );
  }
  const plan = {
    version: 2,
    maps:
      changes.wrongMaps === true
        ? {
            ...unitMaps,
            maps: unitMaps.maps.map((binding) => ({
              ...binding,
              blocksSha256: "c".repeat(64),
            })),
          }
        : unitMaps,
    mode: "pilot",
    acceptance: "unaccepted",
    native:
      changes.wrongRuntime === true
        ? { ...native, runtime: { unit: false } }
        : native,
    actors,
    matchesPerOpponent: 200,
    firstSeed: 500_000_000,
    device: "cpu",
    retries: 0,
    optimized: false,
    pilotAcceptanceChecked: false,
  };
  await writeFile(
    path.join(evaluation, "evaluation-plan.json"),
    jsonText(plan),
  );
  await writeFile(
    path.join(pilot, "strength-evaluation.claimed.json"),
    jsonText({
      output: evaluation,
      planSha256: sha(JSON.stringify(plan)),
    }),
  );
  const candidate = changes.candidate ?? 0;
  await writeFile(
    path.join(model, "actor.onnx"),
    "unit ONNX stand-in; no native session is created",
  );
  const actorSha = await digestFile(path.join(model, "actor.onnx"));
  await writeFile(
    path.join(model, "manifest.json"),
    jsonText({
      ...manifests[candidate],
      schema: 1,
      onnx_sha256: actorSha,
      checkpoint_manifest_sha256: actors[candidate]?.manifestSha256,
    }),
  );
  return { pilot, evaluation, model, actorSha };
}

describe("pilot eligibility for blind review", () => {
  it("binds the first candidate to all three sealed strength reports and original dataset files", async () => {
    const input = await fixture();
    const eligible = await reviewEligibility(
      input.pilot,
      input.evaluation,
      input.model,
    );
    expect(eligible.actor_sha256).toBe(input.actorSha);
    expect(
      eligible.files.filter((file) =>
        file.file.endsWith("/learning/report.json"),
      ),
    ).toHaveLength(3);
    expect(
      eligible.files.filter((file) => file.file.endsWith(".result.json")),
    ).toHaveLength(3);
    expect(
      eligible.files.find(
        (file) => file.file === path.join(input.model, "actor.onnx"),
      )?.sha256,
    ).toBe(input.actorSha);
  });

  it.each([
    { candidate: 1 },
    { failSeed: 2 },
    { reusedMatches: true },
    { wrongRuntime: true },
    { overlap: true },
    { wrongMaps: true },
  ])("rejects changed selection or provenance: %j", async (changes) => {
    const input = await fixture(changes);
    await expect(
      reviewEligibility(input.pilot, input.evaluation, input.model),
    ).rejects.toThrow();
  });

  it("rejects altered frozen weights and a different claimed evaluation", async () => {
    const input = await fixture();
    await writeFile(
      path.join(input.pilot, "seed-2/learning/final/weights.pt"),
      "altered unit weights",
    );
    await expect(
      reviewEligibility(input.pilot, input.evaluation, input.model),
    ).rejects.toThrow("evidence changed");
    await expect(
      reviewEligibility(
        input.pilot,
        path.join(directory, "other-run"),
        input.model,
      ),
    ).rejects.toThrow();
  });

  it("diagnostic pilots never reach dataset or review generation", async () => {
    const output = path.join(directory, "diagnostic");
    await PilotLedger.create(output, {
      version: 1,
      mode: "diagnostic",
      acceptance: "unaccepted",
      seeds: [1, 2, 3],
      seconds: 300,
      device: "cpu",
      dataset: null,
      inputSha256: sha("unit"),
    });
    await expect(
      reviewEligibility(output, directory, directory),
    ).rejects.toThrow("diagnostic pilots");
  });
});
