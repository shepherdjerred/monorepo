import { z } from "zod";
import wire from "#learning-regression-wire";
import { InferenceMetrics } from "#learning/inference.ts";
import { contract } from "#learning/promotion/contract.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

const Count = z.number().int().nonnegative();
const Scalar = z.number();
const CombatAction = z.strictObject({
  move: Count.max(8),
  jump: z.boolean(),
  sneak: z.boolean(),
  sprint: z.boolean(),
  attack: z.boolean(),
});
const Ticket = z.strictObject({
  match: z.uuid(),
  body: z.uuid(),
  life: Count,
  tick: Count,
  yaw: Scalar,
  action: CombatAction,
});
export const RegressionAction = z.strictObject({
  sequence: Count.positive(),
  serverTick: Count,
  botTick: Count,
  match: z.uuid(),
  body: z.uuid(),
  life: Count,
  kit: z.enum(["TROOPER", "LONGBOW", "SHORTBOW", "REWIND"]),
  decision: z.enum(wire.decisions),
  heldSlot: Count.max(8),
  usingItem: z.boolean(),
  targetId: Count.nullable(),
  x: Scalar,
  y: Scalar,
  z: Scalar,
  health: Scalar.min(0).max(20),
  absorption: Scalar.min(0),
  authored: z.array(z.string().min(1)),
  commands: z.array(z.string().min(1)),
  ticket: Ticket.nullable(),
});
export const RegressionTick = z.strictObject({
  sequence: Count.positive(),
  serverTick: Count,
  botTick: Count,
  milliseconds: Scalar.min(0),
  live: z.boolean(),
  batchRows: Count.max(100),
});
export const RegressionDamage = z.strictObject({
  sequence: Count.positive(),
  serverTick: Count,
  attacker: z.uuid(),
  victim: z.uuid(),
  cause: z.string().min(1),
  cancelled: z.boolean(),
  before: Scalar.min(0),
  after: Scalar.min(0),
  velocityX: Scalar,
  velocityY: Scalar,
  velocityZ: Scalar,
});
const Fighter = z.strictObject({
  body: z.uuid(),
  bot: z.boolean(),
  personality: z.string(),
  team: z.enum(["", "red", "blue"]),
  kit: z.enum(["", "trooper", "longbow", "shortbow", "rewind"]),
  alive: z.boolean(),
});
export const RegressionTransition = z.strictObject({
  sequence: Count.positive(),
  serverTick: Count,
  match: z.uuid(),
  event: z.string().min(1),
  phase: z.enum(wire.phases),
  winner: z.enum(["", "red", "blue"]),
  fighters: z.array(Fighter).max(101),
});
export const RegressionSample = z.strictObject({
  protocol: z.literal(wire.version),
  contract: z.literal(wire.contract),
  ready: z.boolean(),
  caseName: z.union([z.literal(""), z.enum(contract.regressionCases)]),
  match: z.union([z.literal(""), z.uuid()]),
  result: z.enum(wire.results),
  phase: z.enum(wire.phases),
  sequence: Count,
  actions: z.array(RegressionAction).max(wire.maximumRows),
  ticks: z.array(RegressionTick).max(wire.maximumRows),
  damage: z.array(RegressionDamage).max(wire.maximumRows),
  transitions: z.array(RegressionTransition).max(wire.maximumRows),
  inference: InferenceMetrics.shape.inference.nullable(),
});
export type RegressionSample = z.infer<typeof RegressionSample>;
export type RegressionAction = z.infer<typeof RegressionAction>;

const schemas = {
  Action: RegressionAction,
  Tick: RegressionTick,
  Damage: RegressionDamage,
  Transition: RegressionTransition,
  Fighter,
  Ticket,
  CombatAction,
  Inference: InferenceMetrics.shape.inference,
};
if (
  wire.version !== 1 ||
  wire.contract !== "rwf-regression-capture-v1" ||
  wire.maximumRows !== 5000 ||
  wire.maximumActionAge !== 2 ||
  JSON.stringify(Object.keys(RegressionSample.shape)) !==
    JSON.stringify(wire.fields) ||
  JSON.stringify(Object.keys(schemas)) !==
    JSON.stringify(Object.keys(wire.records))
)
  throw new Error("Incompatible native regression capture contract");
for (const [name, schema] of Object.entries(schemas)) {
  const fields = Object.entries(wire.records).find(
    ([key]) => key === name,
  )?.[1];
  if (JSON.stringify(Object.keys(schema.shape)) !== JSON.stringify(fields))
    throw new Error(`Native regression validator differs: ${name}`);
}

/** Read each drain once and retain it before issuing the next command. */
export class RegressionClient {
  constructor(
    private readonly rcon: RconClient,
    private readonly retain: (
      command: string,
      state: RegressionSample,
    ) => Promise<void>,
  ) {}

  async command(command: string): Promise<RegressionSample> {
    const response = await this.rcon.command(`rwfinferregression ${command}`);
    const value: unknown = JSON.parse(response.trim());
    const failure = z.strictObject({ error: z.string() }).safeParse(value);
    if (failure.success) throw new Error(failure.data.error);
    const state = RegressionSample.parse(value);
    await this.retain(command, state);
    return state;
  }

  async load(): Promise<void> {
    let state = await this.command("load");
    const deadline = Date.now() + 30_000;
    while (!state.ready) {
      if (Date.now() >= deadline)
        throw new Error("Regression actor warming timed out");
      await Bun.sleep(50);
      state = await this.command("sample");
    }
  }
}
