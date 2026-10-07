import { z } from "zod";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { InferenceMetrics } from "./inference.ts";
import wire from "#learning-load-wire";

const count = z.number().int().nonnegative();
export const LoadTick = z
  .object({
    serverTick: count,
    milliseconds: z.number().nonnegative(),
    match: z.union([z.uuid(), z.literal("")]),
    botTick: count,
    alive: count.max(100),
    observed: count.max(100),
    applied: count.max(100),
    unavailable: count.max(100),
    ineligible: count.max(100),
    live: z.boolean(),
  })
  .strict();
export type LoadTick = z.infer<typeof LoadTick>;
export const LoadSample = z
  .object({
    protocol: z.literal(wire.version),
    contract: z.literal(wire.contract),
    ready: z.boolean(),
    result: z.enum(wire.results),
    phase: z.enum(wire.phases),
    match: z.union([z.uuid(), z.literal("")]),
    seed: count.max(1_000_000_000),
    bots: count.max(100),
    ticks: z.array(LoadTick).max(2000),
    ages: z.array(count).length(3),
    damageEvents: count,
    damage: z.number().nonnegative(),
    inference: InferenceMetrics.shape.inference.optional(),
  })
  .strict();
export type LoadSample = z.infer<typeof LoadSample>;

for (const [actual, expected] of [
  [Object.keys(LoadTick.shape), wire.tickFields],
  [Object.keys(LoadSample.shape), [...wire.required, ...wire.optional]],
] as const) {
  if (
    actual.length !== expected.length ||
    new Set(expected).size !== expected.length ||
    expected.some((field) => !actual.includes(field))
  )
    throw new Error("load validator fields differ from wire contract");
}
if (wire.version !== 1 || wire.contract !== "rwf-inference-load-v1")
  throw new Error("incompatible native load wire contract");

/** Main-thread load fixture console; every reply drains and preserves its tick samples. */
export class InferenceLoadClient {
  constructor(private readonly rcon: RconClient) {}

  async command(command: string): Promise<LoadSample> {
    const response = await this.rcon.command(`rwfinferload ${command}`);
    const reply: unknown = JSON.parse(response.trim());
    const error = z.object({ error: z.string() }).strict().safeParse(reply);
    if (error.success) throw new Error(error.data.error);
    return LoadSample.parse(reply);
  }

  async load(): Promise<void> {
    let state = await this.command("load");
    const deadline = Date.now() + 30_000;
    while (!state.ready) {
      if (Date.now() >= deadline)
        throw new Error("load diagnostic model warming timed out");
      await Bun.sleep(50);
      state = await this.command("sample");
    }
  }
}
