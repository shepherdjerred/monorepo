import { z } from "zod";
import wire from "#health-wire";
import { TraversalCapabilities as HealthCapabilities } from "./traversal-capabilities.ts";
import {
  HealthEnvironment as Environment,
  healthNutrition as nutrition,
  validateEnvironment,
} from "./health-environment.ts";

const tick = z.number().int().nonnegative();
const expiry = z.number().int().min(-1);
const point = z.tuple([z.number(), z.number(), z.number()]);
export const HealthSample = z.strictObject({
  sequence: tick,
  serverTick: tick,
  match: z.uuid(),
  body: z.uuid(),
  world: z.uuid(),
  kit: z.string().min(1),
  alive: z.boolean(),
  health: z.number().nonnegative(),
  absorption: z.number().nonnegative(),
  maxHealth: z.number().positive(),
  lastHurtTick: expiry,
  position: point,
  velocity: point,
  onGround: z.boolean(),
  fallDistance: z.number().nonnegative(),
  noDamageTicks: tick,
  sprinting: z.boolean(),
  inWater: z.boolean(),
  ...nutrition,
  traversal: HealthCapabilities,
});
export const HealthFall = z.strictObject({
  sequence: tick,
  eventTick: tick,
  observedTick: tick,
  predictionSequence: tick,
  cancelled: z.boolean(),
  damage: z.number().nonnegative(),
  before: z.number().nonnegative(),
  after: z.number().nonnegative(),
  beforeAbsorption: z.number().nonnegative(),
  afterAbsorption: z.number().nonnegative(),
  fallDistance: z.number().nonnegative(),
  noDamageTicks: tick,
  snapshotHealth: z.number().nonnegative(),
  hurtTick: expiry,
});
export const HealthSetup = z.strictObject({
  sequence: tick,
  serverTick: tick,
  kind: z.string().min(1),
  details: z.record(z.string(), z.string()),
});
export const HealthRegain = z.strictObject({
  sequence: tick,
  eventTick: tick,
  observedTick: tick,
  sourceSequence: tick,
  resultSequence: tick,
  reason: z.string().regex(/^[A-Z][A-Z_]+$/u),
  amount: z.number().nonnegative(),
  cancelled: z.boolean(),
  before: z.number().nonnegative(),
  after: z.number().nonnegative(),
  ...nutrition,
});
export const HealthPrediction = z.strictObject({
  sequence: tick,
  serverTick: tick,
  sourceSequence: tick,
  arrivalTick: tick,
  damage: z.number().int().nonnegative(),
  effectiveHealth: z.number().nonnegative(),
  affordable: z.boolean(),
  noSprint: z.boolean(),
  waypoint: point,
  fallDistance: z.number().nonnegative(),
});
export const HealthStatus = z.strictObject({
  version: z.literal(3),
  kind: z.literal("controlled-route-diagnostic"),
  humanDemonstration: z.literal(false),
  scenario: z.string(),
  state: z.enum(["idle", "bound", "observing", "refused", "closed", "failed"]),
  match: z.string(),
  body: z.string(),
  world: z.string(),
  samples: z.array(HealthSample),
  falls: z.array(HealthFall),
  setups: z.array(HealthSetup),
  predictions: z.array(HealthPrediction),
  regains: z.array(HealthRegain),
});
const Scenario = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]+$/u),
  kit: z.enum(["trooper", "juggernaut"]),
  landing: z.enum(["ground", "water"]),
  mode: z.enum(["single", "until-refused", "protection-expiry"]),
  maximumDrops: z.number().int().min(1).max(5),
});
const Contract = z.strictObject({
  version: z.literal(3),
  kind: z.literal("controlled-route-diagnostic"),
  humanDemonstration: z.literal(false),
  environment: Environment,
  maximumTicks: z.literal(600),
  records: z.record(z.string(), z.array(z.string())),
  scenarios: z.array(Scenario).min(1),
});
export const healthContract = Contract.parse(wire);
const records = {
  Environment,
  Sample: HealthSample,
  Fall: HealthFall,
  Setup: HealthSetup,
  Regain: HealthRegain,
  Prediction: HealthPrediction,
  Status: HealthStatus,
  Traversal: HealthCapabilities,
};
for (const [name, schema] of Object.entries(records))
  if (
    JSON.stringify(healthContract.records[name]) !==
    JSON.stringify(Object.keys(schema.shape))
  )
    throw new Error(`Health proof contract differs for ${name}`);
if (
  Object.keys(healthContract.records).length !== Object.keys(records).length ||
  new Set(healthContract.scenarios.map((scenario) => scenario.id)).size !==
    healthContract.scenarios.length
)
  throw new Error("Health proof contract inventory differs");

type State = z.infer<typeof HealthStatus>;
type Scenario = (typeof healthContract.scenarios)[number];
type Sample = z.infer<typeof HealthSample>;
type Fall = z.infer<typeof HealthFall>;

/** Native health evidence only; controlled movement never establishes autonomous routing. */
export function summarizeHealth(raw: unknown) {
  const status = HealthStatus.parse(raw);
  const scenario = healthContract.scenarios.find(
    (candidate) => candidate.id === status.scenario,
  );
  const prediction = status.predictions.at(-1);
  if (
    scenario === undefined ||
    prediction === undefined ||
    status.samples.length < 2
  )
    throw new Error(
      "Health proof lacks its original scenario, captures or risk prediction",
    );
  if (
    status.state !== (scenario.mode === "until-refused" ? "refused" : "closed")
  )
    throw new Error(
      "Health proof is not in its original successful terminal state",
    );
  const bounds = validateSamples(status, scenario);
  validateJournal(status, scenario, bounds);
  validatePredictions(status);
  validateRegains(status);
  validateEnvironment(status, healthContract.environment);
  for (const fall of status.falls) validateFall(fall, { status, ...bounds });
  const maximumHealth = validateKit(status, scenario, bounds);
  validateOutcome(status, scenario, prediction);
  return {
    scenario: scenario.id,
    kind: status.kind,
    humanDemonstration: false,
    autonomousRoutingVerified: false,
    maximumHealth,
    nativeFalls: status.falls.length,
    nativeRegains: status.regains.length,
    finalHealth: bounds.last.health,
    riskRefused: status.state === "refused",
    capturedTicks: status.samples.length,
    positivePrefixPredictions: status.predictions.filter(
      (planned) => planned.fallDistance > 0,
    ).length,
  };
}

function validateSamples(status: State, scenario: Scenario) {
  let previous = -1;
  for (const sample of status.samples) {
    if (sample.fallDistance !== sample.traversal.fallDistance)
      throw new Error(
        "Captured fall distance differs from actual body observation",
      );
    if (
      sample.sequence <= previous ||
      sample.match !== status.match ||
      sample.body !== status.body ||
      sample.world !== status.world ||
      sample.kit !== scenario.kit ||
      sample.maxHealth !== sample.traversal.maxHealth ||
      sample.health > sample.maxHealth
    )
      throw new Error(
        "Health capture identity, order or actual maximum differs",
      );
    previous = sample.sequence;
  }
  const first = status.samples[0];
  const last = status.samples.at(-1);
  if (first === undefined || last?.alive !== true)
    throw new Error("Health proof did not retain a living original member");
  return { first, last };
}

function validateJournal(
  status: State,
  scenario: Scenario,
  bounds: { first: Sample; last: Sample },
) {
  const allRows = [
    ...status.samples,
    ...status.falls,
    ...status.setups,
    ...status.predictions,
    ...status.regains,
  ];
  if (
    new Set(allRows.map((row) => row.sequence)).size !== allRows.length ||
    bounds.last.serverTick - bounds.first.serverTick >
      healthContract.maximumTicks
  )
    throw new Error(
      "Health journal repeated a row or exceeded its original tick bound",
    );
  let previousTick = -1;
  for (const row of allRows.toSorted((a, b) => a.sequence - b.sequence)) {
    const at = "serverTick" in row ? row.serverTick : row.observedTick;
    if (at < previousTick)
      throw new Error("Health journal time moved backwards");
    previousTick = at;
  }
  if (status.setups.some((setup) => setup.serverTick > bounds.last.serverTick))
    throw new Error("Health setup extends beyond the original native captures");
  if (
    status.falls.length > scenario.maximumDrops ||
    (scenario.mode === "until-refused" &&
      status.falls.length !== scenario.maximumDrops)
  )
    throw new Error(
      "Health proof did not execute its exact bounded native drops",
    );
}

/** Passive diagnostics may identify native healing causes without passing a controlled trial. */
export function inspectNativeRegains(raw: unknown) {
  const status = HealthStatus.parse(raw);
  validateRegains(status);
  return status.regains;
}

function validateRegains(status: State) {
  const samples = new Map(
    status.samples.map((sample) => [sample.sequence, sample]),
  );
  for (const regain of status.regains) {
    const source = samples.get(regain.sourceSequence);
    const result = samples.get(regain.resultSequence);
    if (
      source?.serverTick !== regain.eventTick ||
      result?.serverTick !== regain.observedTick ||
      regain.observedTick !== regain.eventTick + 1 ||
      regain.resultSequence <= regain.sourceSequence ||
      regain.sequence <= regain.resultSequence ||
      source.match !== status.match ||
      source.body !== status.body ||
      source.world !== status.world ||
      result.match !== status.match ||
      result.body !== status.body ||
      result.world !== status.world ||
      source.health !== regain.before ||
      result.health !== regain.after ||
      source.foodLevel !== regain.foodLevel ||
      source.saturation !== regain.saturation ||
      source.difficulty !== regain.difficulty
    )
      throw new Error(
        "Native healing receipt differs from its original body captures",
      );
  }
}

function validatePredictions(status: State) {
  for (const planned of status.predictions) {
    const source = status.samples.find(
      (sample) => sample.sequence === planned.sourceSequence,
    );
    if (
      source?.serverTick !== planned.serverTick ||
      source.health + source.absorption !== planned.effectiveHealth ||
      planned.arrivalTick <= planned.serverTick ||
      planned.affordable !== planned.damage <= planned.effectiveHealth - 1 ||
      planned.noSprint === source.traversal.maySprint ||
      planned.fallDistance !== source.traversal.fallDistance
    )
      throw new Error(
        "Controlled risk prediction differs from the actual captured body",
      );
  }
}

function validateFall(
  fall: Fall,
  context: { status: State; first: Sample; last: Sample },
) {
  const planned = context.status.predictions.find(
    (candidate) => candidate.sequence === fall.predictionSequence,
  );
  const source = context.status.samples.find(
    (sample) => sample.sequence === planned?.sourceSequence,
  );
  if (
    source === undefined ||
    source.onGround ||
    source.traversal.fallDistance <= 0
  )
    throw new Error(
      "Native FALL lacks a positive captured accumulated-fall prediction",
    );
  if (
    planned === undefined ||
    fall.observedTick <= fall.eventTick ||
    fall.snapshotHealth !== fall.after ||
    fall.eventTick < context.first.serverTick ||
    fall.observedTick > context.last.serverTick ||
    planned.serverTick > fall.eventTick ||
    !planned.affordable ||
    (!fall.cancelled && planned.damage < fall.damage)
  )
    throw new Error(
      "Native FALL was not observed after vanilla damage application",
    );
  const lost =
    fall.before + fall.beforeAbsorption - fall.after - fall.afterAbsorption;
  if (
    lost < 0 ||
    Math.abs(lost - (fall.cancelled ? 0 : fall.damage)) > 1e-5 ||
    (lost > 0 && fall.hurtTick <= fall.eventTick)
  )
    throw new Error(
      "Native FALL health or hurt timestamp differs from the event",
    );
}

function validateKit(
  status: State,
  scenario: Scenario,
  bounds: { first: Sample; last: Sample },
) {
  const maximum = scenario.kit === "juggernaut" ? 30 : 20;
  if (status.samples.some((sample) => sample.maxHealth !== maximum))
    throw new Error("Real joined kit did not supply its actual maximum health");
  if (bounds.first.health !== maximum)
    throw new Error(
      "Health proof did not begin with its real kit health grant",
    );
  if (
    scenario.kit === "juggernaut" &&
    status.samples.some(
      (sample) => sample.traversal.maySprint || sample.sprinting,
    )
  )
    throw new Error("Juggernaut capture or native sprint restriction differs");
  return maximum;
}

function validateOutcome(
  status: State,
  scenario: Scenario,
  prediction: z.infer<typeof HealthPrediction>,
) {
  if (scenario.landing === "water") {
    if (
      !status.samples.some((sample) => sample.inWater) ||
      status.falls.some((fall) => fall.after !== fall.before)
    )
      throw new Error("Water landing did not retain native health");
  } else if (
    status.falls.length === 0 ||
    !status.falls.some((fall) => fall.after < fall.before)
  ) {
    throw new Error("Ground course has no actual native FALL damage");
  }
  if (
    scenario.mode === "until-refused" &&
    (prediction.affordable ||
      prediction.damage <= prediction.effectiveHealth - 1)
  )
    throw new Error(
      "Current native health did not refuse the next lethal controlled drop",
    );
  if (scenario.mode === "protection-expiry") validateProtection(status);
}

function validateProtection(status: State) {
  const protectedFall = status.falls[0];
  const expiredFall = status.falls.at(-1);
  if (
    protectedFall === undefined ||
    expiredFall === undefined ||
    status.falls.length !== 2 ||
    expiredFall.damage <= protectedFall.damage ||
    !status.samples.some(
      (sample) => sample.traversal.resistanceUntilTick > sample.serverTick,
    ) ||
    !status.samples.some(
      (sample) => sample.traversal.resistanceUntilTick === -1,
    ) ||
    !status.setups.some((setup) => setup.kind === "effect-add") ||
    !status.setups.some((setup) => setup.kind === "effect-expired")
  )
    throw new Error(
      "Actual captured protection did not expire between real falls",
    );
}
