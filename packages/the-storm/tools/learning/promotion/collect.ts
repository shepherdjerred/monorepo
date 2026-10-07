import path from "node:path";
import { z } from "zod";
import { PilotLedger } from "#learning/pilot-ledger.ts";
import { reviewEligibility } from "#learning/preference/eligibility.ts";
import { PreferenceLedger, sha } from "#learning/preference/ledger.ts";
import { Digest } from "#learning/preference/gate.ts";
import { strengthResult } from "#learning/evaluation-gate.ts";
import type { Snapshot } from "./archive.ts";
import { Proof, RegressionEvidence, contract } from "./contract.ts";
import { root } from "#learning/sandbox.ts";

export type Request = {
  pilot: string;
  evaluation: string;
  model: string;
  review: string;
  parity: string;
  receipt: string;
  load: string;
  regressions: string;
  output: string;
};

const Export = z.object({
  schema: z.literal(1),
  kind: z.literal("rwf-trooper-ppo"),
  acceptance: z.literal("unaccepted"),
  onnx_sha256: Digest,
  checkpoint_manifest_sha256: Digest,
  weights_sha256: Digest,
  training: z.object({ seed: z.number().int(), dataset_sha256: Digest }),
});

async function seed(
  snapshot: Snapshot,
  request: Request,
  pilot: PilotLedger,
  index: number,
) {
  const state = await pilot.state(index);
  if (state.status !== "frozen")
    throw new Error("promotion requires all original sealed pilot seeds");
  const reportFile = path.join(
    request.evaluation,
    `seed-${index.toString()}/learning/report.json`,
  );
  const strength = strengthResult(
    await snapshot.json(reportFile),
    200,
    500_000_000,
  );
  if (!strength.passed)
    throw new Error(
      "promotion requires every seed to pass frozen strength gates",
    );
  const wins = (opponent: string) => {
    const result = strength.opponents.find((row) => row.opponent === opponent);
    if (result === undefined)
      throw new Error(`missing strength opponent: ${opponent}`);
    return result.wins;
  };
  return Proof.shape.pilot.shape.seeds.element.parse({
    seed: state.claim.seed,
    started_ms: state.claim.startedMs,
    deadline_ms: state.claim.deadlineMs,
    completed_ms: state.completedMs,
    claim_sha256: await snapshot.add(
      path.join(request.pilot, `seed-${index.toString()}.claimed.json`),
    ),
    result_sha256: await snapshot.add(
      path.join(request.pilot, `seed-${index.toString()}.result.json`),
    ),
    checkpoint_manifest_sha256: state.manifestSha256,
    weights_sha256: state.weightsSha256,
    matches_per_opponent: 200,
    authored_wins: wins("authored"),
    basic_wins: wins("basic"),
    strength_sha256: await snapshot.add(reportFile),
  });
}

export async function collectTraining(snapshot: Snapshot, request: Request) {
  const eligible = await reviewEligibility(
    request.pilot,
    request.evaluation,
    request.model,
  );
  await snapshot.include(eligible.files);
  const pilot = await PilotLedger.read(request.pilot);
  const inputs = z
    .object({
      native: z.object({
        hashes: z.array(z.object({ file: z.string(), sha256: Digest })),
      }),
    })
    .parse(await snapshot.json(path.join(request.pilot, "inputs.json")));
  for (const file of inputs.native.hashes)
    await snapshot.add(path.join(root, file.file), file.sha256);
  const candidate = Export.parse(
    await snapshot.json(path.join(request.model, "manifest.json")),
  );
  const seeds = [];
  for (let index = 0; index < 3; index++)
    seeds.push(await seed(snapshot, request, pilot, index));
  const first = seeds[0];
  if (first === undefined) throw new Error("first sealed candidate is missing");
  if (
    candidate.training.seed !== first.seed ||
    candidate.onnx_sha256 !== eligible.actor_sha256 ||
    candidate.weights_sha256 !== first.weights_sha256 ||
    candidate.checkpoint_manifest_sha256 !== first.checkpoint_manifest_sha256
  )
    throw new Error("promotion candidate differs from original first seed");
  return {
    actor_sha256: candidate.onnx_sha256,
    source_manifest_sha256: await snapshot.add(
      path.join(request.model, "manifest.json"),
    ),
    checkpoint_manifest_sha256: first.checkpoint_manifest_sha256,
    weights_sha256: first.weights_sha256,
    dataset_sha256: candidate.training.dataset_sha256,
    native_sha256: eligible.native_sha256,
    pilot: Proof.shape.pilot.parse({
      ledger_sha256: await snapshot.add(path.join(request.pilot, "pilot.json")),
      inputs_sha256: await snapshot.add(
        path.join(request.pilot, "inputs.json"),
      ),
      strength_claim_sha256: await snapshot.add(
        path.join(request.pilot, "strength-evaluation.claimed.json"),
      ),
      strength_plan_sha256: await snapshot.add(
        path.join(request.evaluation, "evaluation-plan.json"),
      ),
      seeds,
    }),
  };
}

export async function collectPreference(
  snapshot: Snapshot,
  request: Request,
  candidate: { actor_sha256: string; pilot: Proof["pilot"] },
) {
  const claim = path.join(request.pilot, "blind-preference.claimed.json");
  const ledger = await PreferenceLedger.read(request.review, claim);
  const verified = await ledger.verifyResult();
  if (
    !verified.result.passed ||
    verified.result.actor_sha256 !== candidate.actor_sha256
  )
    throw new Error(
      "promotion requires the original passing human review for this actor",
    );
  await snapshot.include(verified.files);
  const first = candidate.pilot.seeds[0];
  if (first === undefined) throw new Error("first candidate seed missing");
  const result = verified.result;
  return Proof.shape.preference.parse({
    candidate_seed: first.seed,
    pairs: result.pairs,
    learned_votes: result.learnedVotes,
    authored_votes: result.authoredVotes,
    ties: result.ties,
    source: "manual-human-review",
    claim_sha256: await snapshot.add(claim),
    plan_sha256: result.plan_sha256,
    review_sha256: result.review_sha256,
    key_sha256: result.key_sha256,
    ballot_sha256: result.ballot_sha256,
    result_sha256: await snapshot.add(
      path.join(request.review, "preference-result.json"),
    ),
  });
}

export async function collectRegressions(
  snapshot: Snapshot,
  request: Request,
  candidate: { actor_sha256: string; native_sha256: string },
) {
  const evidence = RegressionEvidence.parse(
    await snapshot.json(request.regressions),
  );
  if (
    evidence.actor_sha256 !== candidate.actor_sha256 ||
    evidence.native_sha256 !== candidate.native_sha256
  )
    throw new Error(
      "regression evidence differs from original actor or native runtime",
    );
  if (
    JSON.stringify(evidence.cases.map((test) => test.name)) !==
    JSON.stringify(contract.regressionCases)
  )
    throw new Error("regression evidence differs from required fixed cases");
  return Proof.shape.regressions.parse({
    actor_sha256: evidence.actor_sha256,
    native_sha256: evidence.native_sha256,
    cases: evidence.cases,
    native_floors: evidence.native_floors,
    simulation_floors: evidence.simulation_floors,
    evidence_sha256: await snapshot.add(request.regressions),
  });
}

export const nativeFingerprint = (native: {
  hashes: { file: string; sha256: string }[];
}) =>
  sha(
    JSON.stringify({
      ...native,
      hashes: native.hashes.filter(
        (file) => !file.file.startsWith("tools/learning/"),
      ),
    }),
  );
