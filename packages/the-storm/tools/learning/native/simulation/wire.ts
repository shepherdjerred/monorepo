import { z } from "zod";
import wire from "#learning-simulation-wire";

export const simulationContract = Object.freeze(wire);
const Count = z.number().int().nonnegative();
const RunId = Count.min(1).max(16);
const BodyId = Count.min(1).max(16);
const Metric = z.number().nonnegative();
export const Header = z.strictObject({
  type: z.literal("header"),
  schema: z.literal(wire.version),
  contract: z.literal(wire.contract),
  source: z.literal("authored-simulation"),
  humanDemonstration: z.literal(false),
  trainingData: z.literal(false),
});
export const Run = z.strictObject({
  type: z.literal("run"),
  run: RunId,
  seed: Count.min(wire.firstSeed).max(wire.firstSeed + 15),
  red: z.enum(wire.strategies),
  blue: z.enum(wire.strategies),
});
export const Body = z.strictObject({
  id: BodyId,
  team: z.enum(["RED", "BLUE"]),
  kit: z.enum(["TROOPER", "LONGBOW", "SHORTBOW", "REWIND"]),
  x: z.number(),
  z: z.number(),
  alive: z.boolean(),
  attacks: z.array(BodyId).max(1),
  slot: z.enum(wire.slots),
});
export const Tick = z.strictObject({
  type: z.literal("tick"),
  run: RunId,
  tick: Count.max(wire.maximumTicks - 1),
  ready: z.boolean(),
  bodies: z.array(Body).length(wire.perTeam * 2),
});
export const Metrics = z.strictObject({
  team: z.enum(["RED", "BLUE"]),
  widthAt8: Metric,
  widthAtContact: Metric,
  forwardBy10: Metric.max(1),
  winding: Metric,
});
export const End = z.strictObject({
  type: z.literal("end"),
  run: RunId,
  tick: Count.max(wire.maximumTicks),
  contact: Count.positive()
    .max(wire.maximumTicks - 1)
    .nullable(),
  measurements: z.array(Metrics).length(2),
});
export const Complete = z.strictObject({
  type: z.literal("complete"),
  runs: z.literal(16),
});
export const SimulationRow = z.discriminatedUnion("type", [
  Header,
  Run,
  Tick,
  End,
  Complete,
]);
export type SimulationBody = z.infer<typeof Body>;
export type SimulationTick = z.infer<typeof Tick>;
export type SimulationRun = z.infer<typeof Run>;
export type SimulationEnd = z.infer<typeof End>;
export type SimulationMetrics = z.infer<typeof Metrics>;

const records = { Header, Run, Tick, Body, End, Metrics, Complete };
if (
  JSON.stringify(Object.keys(records)) !==
  JSON.stringify(Object.keys(wire.records))
)
  throw new Error("Simulation capture record inventory differs");
for (const [name, schema] of Object.entries(records)) {
  const fields = z.array(z.string()).parse(Reflect.get(wire.records, name));
  if (JSON.stringify(Object.keys(schema.shape)) !== JSON.stringify(fields))
    throw new Error(`Simulation capture fields differ: ${name}`);
}
if (
  wire.version !== 1 ||
  wire.contract !== "rwf-authored-simulation-floors-v1" ||
  JSON.stringify(wire.strategies) !== '["RUSH","SPLIT","TURTLE","HUNT"]' ||
  JSON.stringify(wire.attackingStrategies) !== '["RUSH","SPLIT","HUNT"]' ||
  wire.firstSeed !== 10 ||
  wire.perTeam !== 8 ||
  wire.maximumTicks !== 900 ||
  wire.spreadTick !== 160 ||
  wire.forwardTick !== 200 ||
  wire.sampleTicks !== 10 ||
  wire.third !== 20 ||
  JSON.stringify(wire.slots) !==
    '["","PLANT","ESCORT","LANE","FLANK","OVERWATCH","ANCHOR","SWEEP"]' ||
  JSON.stringify(wire.lineup) !==
    '["TROOPER","LONGBOW","TROOPER","TROOPER","SHORTBOW","TROOPER","TROOPER","REWIND"]'
)
  throw new Error("Simulation capture differs from the fixed advancement test");
