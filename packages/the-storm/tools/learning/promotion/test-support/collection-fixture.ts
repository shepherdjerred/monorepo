import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PilotLedger } from "#learning/pilot-ledger.ts";
import { evaluationSchedule } from "#learning/evaluation-gate.ts";
import { reviewEligibility } from "#learning/preference/eligibility.ts";
import {
  PreferenceLedger,
  digestFile,
  jsonText,
  readJson,
  sha,
} from "#learning/preference/ledger.ts";
import { AnswerKey } from "#learning/preference/gate.ts";
import { root } from "#learning/sandbox.ts";
import { contract } from "#learning/promotion/contract.ts";
import {
  nativeFingerprint,
  type Request,
} from "#learning/promotion/collect.ts";
import { loadProtocol } from "#learning/load-gate.ts";
import { recomputeLoadEvidence } from "#learning/promotion/load-evidence.ts";
import { loadFixture } from "./load-fixture.ts";

/** Text artifacts and synthetic counters only. Preparing these can never constitute a real pilot. */
export async function collectionFixture(directory: string, votes = 15) {
  const request: Request = {
    pilot: path.join(directory, "pilot"),
    evaluation: path.join(directory, "evaluation"),
    model: path.join(directory, "model"),
    review: path.join(directory, "review"),
    parity: path.join(directory, "parity"),
    receipt: path.join(directory, "parity/receipt.json"),
    load: path.join(directory, "load"),
    regressions: path.join(directory, "regressions.json"),
    output: path.join(directory, "bundle"),
  };
  const dataset = path.join(directory, "dataset");
  for (const folder of [
    dataset,
    request.model,
    request.evaluation,
    request.parity,
    request.load,
  ])
    await mkdir(folder);
  const sources = [];
  for (const file of [
    "manifest.json",
    "train.jsonl",
    "validation.jsonl",
    "test.jsonl",
  ]) {
    await writeFile(
      path.join(dataset, file),
      `synthetic dataset boundary: ${file}`,
    );
    sources.push({ file, sha256: await digestFile(path.join(dataset, file)) });
  }
  const datasetSha = await digestFile(path.join(dataset, "manifest.json"));
  const nativeFile = path.join(directory, "native-unit.fixture");
  await writeFile(nativeFile, "synthetic native bytes, not a server");
  const native = {
    hashes: [
      {
        file: path.relative(root, nativeFile),
        sha256: await digestFile(nativeFile),
      },
    ],
    engine: "Paper",
    controllerHz: 20,
    timeoutTicks: 1200,
    runtime: { synthetic: "codec only" },
  };
  const inputs = {
    native,
    dataset: sources,
    bunVersion: "unit",
    platform: "darwin",
    arch: "arm64",
  };
  const pilot = await PilotLedger.create(request.pilot, {
    version: 1,
    mode: "pilot",
    acceptance: "unaccepted",
    device: "cpu",
    dataset,
    inputSha256: sha(jsonText(inputs)),
    seeds: [11, 12, 13],
    seconds: 28_800,
  });
  await writeFile(path.join(request.pilot, "inputs.json"), jsonText(inputs));
  const actors = [];
  const checkpoints = [];
  for (let index = 0; index < 3; index++) {
    const checkpoint = path.join(
      request.pilot,
      `seed-${index.toString()}/learning/final`,
    );
    await mkdir(checkpoint, { recursive: true });
    const weights = `synthetic checkpoint boundary ${index.toString()}`;
    const manifest = {
      schema: 1,
      kind: "rwf-trooper-ppo",
      acceptance: "unaccepted",
      contract_sha256: sha("unit observation contract"),
      weights_sha256: sha(weights),
      training: {
        seed: 11 + index,
        dataset_sha256: datasetSha,
        provenance: "human-bc-plus-paper-ppo",
        test_used_for_selection: false,
        pilot_acceptance_checked: false,
        curriculum: { complete: true },
        games: [],
      },
    };
    checkpoints.push(manifest);
    await writeFile(path.join(checkpoint, "weights.pt"), weights);
    await writeFile(path.join(checkpoint, "manifest.json"), jsonText(manifest));
    await pilot.claim(index, index * 28_800_000);
    await pilot.finish(index, {
      status: "frozen",
      completedMs: index * 28_800_000 + 100,
      weightsSha256: sha(weights),
      manifestSha256: sha(jsonText(manifest)),
    });
    actors.push({
      checkpoint,
      seed: 11 + index,
      weightsSha256: sha(weights),
      manifestSha256: sha(jsonText(manifest)),
    });
    const output = path.join(
      request.evaluation,
      `seed-${index.toString()}/learning`,
    );
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, "report.json"),
      jsonText({
        version: 1,
        engine: "Paper",
        mode: "pilot",
        acceptance: "unaccepted",
        actor_seed: 11 + index,
        weights_sha256: sha(weights),
        manifest_sha256: sha(jsonText(manifest)),
        optimized: false,
        retried_duels: 0,
        blind_preference_checked: false,
        pilot_acceptance_checked: false,
        games: evaluationSchedule(200, 500_000_000).map((match, game) => ({
          ...match,
          match: `00000000-0000-4000-8000-${(index * 400 + game).toString().padStart(12, "0")}`,
          result:
            game % 200 < (match.opponent === "authored" ? 120 : 160)
              ? "win"
              : "timeout",
          frames: 10,
          submitted_controls: 10,
          confirmed_controls: 10,
          applied_controls: 10,
          authored_fallbacks: 0,
          missed_ticks: 0,
          rejected_actions: 0,
          memory_resets: 0,
          dealt: 1,
          received: 1,
          seconds: 1,
          max_inference_ms: 1,
        })),
      }),
    );
  }
  const plan = {
    version: 1,
    mode: "pilot",
    acceptance: "unaccepted",
    native,
    actors,
    matchesPerOpponent: 200,
    firstSeed: 500_000_000,
    device: "cpu",
    retries: 0,
    optimized: false,
    pilotAcceptanceChecked: false,
  };
  await writeFile(
    path.join(request.evaluation, "evaluation-plan.json"),
    jsonText(plan),
  );
  await writeFile(
    path.join(request.pilot, "strength-evaluation.claimed.json"),
    jsonText({
      output: request.evaluation,
      planSha256: sha(JSON.stringify(plan)),
    }),
  );
  await writeFile(
    path.join(request.model, "actor.onnx"),
    "unit boundary only; no native model",
  );
  const actorSha = await digestFile(path.join(request.model, "actor.onnx"));
  const exported = {
    ...checkpoints[0],
    onnx_sha256: actorSha,
    checkpoint_manifest_sha256: actors[0]?.manifestSha256,
  };
  await writeFile(
    path.join(request.model, "manifest.json"),
    jsonText(exported),
  );
  const eligible = await reviewEligibility(
    request.pilot,
    request.evaluation,
    request.model,
  );
  const files = [...eligible.files];
  const pairs = [];
  for (let pair = 1; pair <= 20; pair++) {
    const learned = path.join(directory, `learned-${pair.toString()}.fixture`);
    const authored = path.join(
      directory,
      `authored-${pair.toString()}.fixture`,
    );
    for (const file of [learned, authored]) {
      await writeFile(file, `synthetic footage boundary ${file}`);
      files.push({ file, sha256: await digestFile(file) });
    }
    pairs.push({ pair, learned, authored });
  }
  const review = await PreferenceLedger.create(
    request.review,
    path.join(request.pilot, "blind-preference.claimed.json"),
    {
      version: 1,
      actor_sha256: actorSha,
      files,
      pairs,
    },
  );
  await review.pack(copyFile);
  const key = AnswerKey.parse(
    await readJson(path.join(request.review, "key.json")),
  );
  const ballot = path.join(directory, "ballot.json");
  await writeFile(
    ballot,
    jsonText({
      version: 1,
      review_sha256: key.review_sha256,
      source: "manual-human-review",
      answers: key.pairs.map((pair, index) => ({
        pair: pair.pair,
        choice: index < votes ? pair.learned : "tie",
        reason: "synthetic codec vote",
      })),
    }),
  );
  await review.score(ballot);
  await mkdir(path.join(request.parity, "onnx"));
  for (const file of ["actor.onnx", "manifest.json"])
    await copyFile(
      path.join(request.model, file),
      path.join(request.parity, "onnx", file),
    );
  const bindings = {
    onnx_sha256: actorSha,
    actor_manifest_sha256: await digestFile(
      path.join(request.model, "manifest.json"),
    ),
    checkpoint_manifest_sha256: actors[0]?.manifestSha256,
    weights_sha256: actors[0]?.weightsSha256,
    contract_sha256: exported.contract_sha256,
  };
  await writeFile(
    path.join(request.parity, "samples.json"),
    jsonText({ schema: 2, ...bindings, rtol: 1e-4, atol: 1e-5, cases: [] }),
  );
  await writeFile(
    request.receipt,
    jsonText({
      schema: 1,
      kind: "rwf-actor-parity",
      acceptance: "unaccepted",
      backend: "onnxruntime-java-cpu",
      parity_contract_sha256: await digestFile(
        path.join(
          root,
          "plugin/modules/rwfbots/src/main/resources/rwf-actor-parity.json",
        ),
      ),
      artifacts: {
        ...bindings,
        samples_sha256: await digestFile(
          path.join(request.parity, "samples.json"),
        ),
      },
      rtol: 1e-4,
      atol: 1e-5,
      replay: { batches: [1, 3, 20, 100], steps: 16, maximumAbsoluteError: 0 },
    }),
  );
  const load = loadFixture();
  const loadInputs = {
    native,
    loadSources: native.hashes,
    artifacts: { manifest: bindings.actor_manifest_sha256, actor: actorSha },
    protocol: loadProtocol,
    acceptance: "unaccepted",
    pilotAcceptanceChecked: false,
    learnedControlEnabled: false,
  };
  await writeFile(path.join(request.load, "inputs.json"), jsonText(loadInputs));
  await writeFile(
    path.join(request.load, "phases.json"),
    jsonText(load.measurements),
  );
  await writeFile(path.join(request.load, "samples.jsonl"), load.log());
  await writeFile(
    path.join(request.load, "verification.json"),
    jsonText({
      ...loadInputs,
      ...recomputeLoadEvidence(load.measurements, load.log()),
    }),
  );
  await writeFile(
    request.regressions,
    jsonText({
      schema: 1,
      kind: "rwf-actor-regressions",
      acceptance: "unaccepted",
      actor_sha256: actorSha,
      native_sha256: nativeFingerprint(native),
      cases: contract.regressionCases.map((name) => ({
        name,
        checks: 1,
        failures: 0,
        skipped: 0,
      })),
      native_floors: {
        bots: 16,
        minimum_spacing: 2.5,
        minimum_width_at_8: 16,
        minimum_width_at_contact: 16,
        minimum_forward: 0.25,
        maximum_winding: 2.5,
      },
      simulation_floors: {
        strategy_pairs: 16,
        contacts: 16,
        minimum_width: 15,
        median_width: 24,
        mean_forward: 0.45,
        maximum_winding: 2.5,
      },
    }),
  );
  return request;
}

export async function datasetBoundary(command: string[]) {
  if (command.includes("preference.inputs")) {
    const dataset = command.at(-1);
    if (dataset === undefined) throw new Error("unit dataset path missing");
    return JSON.stringify({
      dataset_sha256: await digestFile(path.join(dataset, "manifest.json")),
    });
  }
  if (command.includes("--verify-samples")) {
    const sampleFile = command.at(-1);
    if (sampleFile === undefined) throw new Error("unit sample path missing");
    return JSON.stringify({ samples_sha256: sha(await readFile(sampleFile)) });
  }
  throw new Error("unit boundary forbids native sealing or external processes");
}
