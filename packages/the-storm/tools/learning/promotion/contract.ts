import { z } from "zod";
import wire from "#learning-promotion-wire";
import { Digest } from "#learning/preference/gate.ts";

export const contract = Object.freeze(wire);
export const Count = z.number().int().nonnegative();
const Metric = z.number().nonnegative();
const File = z.object({ file: z.string().min(1), sha256: Digest }).strict();
const Seed = z
  .object({
    seed: Count.max(1_000_000_000),
    started_ms: Count,
    deadline_ms: Count,
    completed_ms: Count,
    claim_sha256: Digest,
    result_sha256: Digest,
    checkpoint_manifest_sha256: Digest,
    weights_sha256: Digest,
    matches_per_opponent: z.literal(contract.matchesPerOpponent),
    authored_wins: Count.min(contract.minimumAuthoredWins).max(
      contract.matchesPerOpponent,
    ),
    basic_wins: Count.min(contract.minimumBasicWins).max(
      contract.matchesPerOpponent,
    ),
    strength_sha256: Digest,
  })
  .strict();
const Pilot = z
  .object({
    ledger_sha256: Digest,
    inputs_sha256: Digest,
    strength_claim_sha256: Digest,
    strength_plan_sha256: Digest,
    seeds: z.array(Seed).length(contract.seeds),
  })
  .strict();
const Preference = z
  .object({
    candidate_seed: Count,
    pairs: z.literal(contract.preferencePairs),
    learned_votes: Count.min(contract.minimumLearnedVotes),
    authored_votes: Count,
    ties: Count,
    source: z.literal("manual-human-review"),
    claim_sha256: Digest,
    plan_sha256: Digest,
    review_sha256: Digest,
    key_sha256: Digest,
    ballot_sha256: Digest,
    result_sha256: Digest,
  })
  .strict();
const Parity = z
  .object({
    receipt_sha256: Digest,
    samples_sha256: Digest,
    batches: z.array(Count),
    steps: z.literal(contract.paritySteps),
    rtol: z.literal(contract.rtol),
    atol: z.literal(contract.atol),
  })
  .strict();
const Population = z
  .object({
    bots: Count,
    ticks: Count,
    live_ticks: Count,
    full_roster_ticks: Count,
    submitted: Count,
    skipped: Count,
    rejected: Count,
    deadline_met: Count,
    deadline_missed: Count,
    maximum_batch: Count,
    p95: Metric,
    live_p95: Metric,
    full_roster_p95: Metric,
    applied: Count,
    damage: Metric,
    damage_events: Count,
  })
  .strict();
const Load = z
  .object({
    inputs_sha256: Digest,
    phases_sha256: Digest,
    log_sha256: Digest,
    result_sha256: Digest,
    cpus: z.literal(contract.cpus),
    heap: z.literal(contract.heap),
    memory_limit_bytes: z.literal(contract.memoryLimitBytes),
    baseline_ticks: Count,
    baseline_p95: Metric,
    phases: z.array(Population).length(contract.loadPopulations.length),
  })
  .strict();
const Case = z
  .object({
    name: z.string(),
    checks: Count.positive(),
    failures: z.literal(0),
    skipped: z.literal(0),
  })
  .strict();
const NativeFloors = z
  .object({
    bots: z.literal(16),
    minimum_spacing: Metric.min(contract.nativeFloors.spacing),
    minimum_width_at_8: Metric.min(contract.nativeFloors.width),
    minimum_width_at_contact: Metric.min(contract.nativeFloors.width),
    minimum_forward: Metric.min(contract.nativeFloors.forward),
    maximum_winding: Metric.max(contract.nativeFloors.winding),
  })
  .strict();
const SimulationFloors = z
  .object({
    strategy_pairs: z.literal(16),
    contacts: z.literal(16),
    minimum_width: Metric.min(contract.simulationFloors.width),
    median_width: Metric.min(contract.simulationFloors.medianWidth),
    mean_forward: Metric.min(contract.simulationFloors.forward),
    maximum_winding: Metric.max(contract.simulationFloors.winding),
  })
  .strict();
const Regressions = z
  .object({
    evidence_sha256: Digest,
    actor_sha256: Digest,
    native_sha256: Digest,
    cases: z.array(Case).length(contract.regressionCases.length),
    native_floors: NativeFloors,
    simulation_floors: SimulationFloors,
  })
  .strict();
export const Proof = z
  .object({
    schema: z.literal(contract.version),
    kind: z.literal(contract.kind),
    promotion_contract_sha256: Digest,
    actor_sha256: Digest,
    source_manifest_sha256: Digest,
    checkpoint_manifest_sha256: Digest,
    weights_sha256: Digest,
    dataset_sha256: Digest,
    native_sha256: Digest,
    pilot: Pilot,
    preference: Preference,
    parity: Parity,
    load: Load,
    regressions: Regressions,
    files: z.array(File).min(1),
  })
  .strict();
export type Proof = z.infer<typeof Proof>;
export const Native = z
  .object({
    hashes: z.array(File).min(1),
    engine: z.literal("Paper"),
    controllerHz: z.literal(20),
    timeoutTicks: z.literal(1200),
    runtime: z.record(z.string(), z.unknown()),
  })
  .strict();
export const RegressionEvidence = Regressions.omit({ evidence_sha256: true })
  .extend({
    schema: z.literal(1),
    kind: z.literal("rwf-actor-regressions"),
    acceptance: z.literal("unaccepted"),
  })
  .strict();

const schemas = {
  File,
  Pilot,
  Seed,
  Preference,
  Parity,
  Load,
  Population,
  Regressions,
  Case,
  NativeFloors,
  SimulationFloors,
};
const recordFields = new Map(Object.entries(contract.recordFields));
for (const [name, schema] of Object.entries(schemas)) {
  if (
    JSON.stringify(Object.keys(schema.shape)) !==
    JSON.stringify(recordFields.get(name))
  )
    throw new Error(`promotion schema fields differ: ${name}`);
}
if (recordFields.size !== Object.keys(schemas).length)
  throw new Error("unsupported promotion record inventory");
if (
  JSON.stringify(Object.keys(Proof.shape)) !==
  JSON.stringify(contract.proofFields)
)
  throw new Error("promotion proof fields differ");
if (
  contract.version !== 1 ||
  contract.kind !== "rwf-trooper-promotion-v1" ||
  contract.seeds !== 3 ||
  contract.seedSeconds !== 28_800 ||
  contract.matchesPerOpponent !== 200 ||
  contract.minimumAuthoredWins !== 120 ||
  contract.minimumBasicWins !== 160 ||
  contract.preferencePairs !== 20 ||
  contract.minimumLearnedVotes !== 15 ||
  JSON.stringify(contract.parityBatches) !== "[1,3,20,100]" ||
  contract.paritySteps !== 16 ||
  contract.rtol !== 1e-4 ||
  contract.atol !== 1e-5
)
  throw new Error("unsupported promotion quality contract");
