import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  ActorNameSchema,
  BlockPosSchema,
  GameModeSchema,
} from "#protocol/bridge.ts";
import { ProfileSchema } from "#protocol/ipc.ts";
import type { ScenarioMeta } from "#protocol/playtest.ts";
import type { Scenario } from "#playtest/define.ts";

export const DEFAULT_SCENARIO_TIMEOUT_MS = 120_000;

const Phase = z.custom<Scenario["run"]>(
  (value) => typeof value === "function",
  "must be an async function (context) => {...}",
);

/**
 * Runtime shape of a playtest module's default export. `defineScenario` types
 * it for authors; this guards files that skipped it or drifted.
 */
const ScenarioSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().optional(),
  requires: z
    .strictObject({
      profiles: z.array(ProfileSchema).optional(),
      plugins: z.array(z.string().min(1)).optional(),
      capabilities: z.array(z.enum(["worldedit", "citizens"])).optional(),
    })
    .optional(),
  world: z.string().min(1).optional(),
  actors: z
    .record(
      ActorNameSchema,
      z.strictObject({
        at: BlockPosSchema,
        gameMode: GameModeSchema.optional(),
        op: z.boolean().optional(),
      }),
    )
    .optional(),
  region: z
    .strictObject({ min: BlockPosSchema, max: BlockPosSchema })
    .optional(),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(30 * 60 * 1000)
    .optional(),
  setup: Phase.optional(),
  run: Phase,
});

const ModuleSchema = z.object({ default: ScenarioSchema });

/** Imports a playtest file and validates its default export. */
export async function loadScenario(file: string): Promise<Scenario> {
  const module: unknown = await import(pathToFileURL(file).href);
  const parsed = ModuleSchema.safeParse(module);
  if (!parsed.success) {
    throw new TypeError(
      `${file} must default-export defineScenario({...}) from @shepherdjerred/mc-harness/playtest/define.ts:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data.default;
}

/** The scenario's static requirements, with Citizens implied by declared actors. */
export function scenarioMeta(scenario: Scenario): ScenarioMeta {
  const capabilities = new Set(scenario.requires?.capabilities);
  if (Object.keys(scenario.actors ?? {}).length > 0) {
    capabilities.add("citizens");
  }
  return {
    name: scenario.name,
    description: scenario.description ?? "",
    requires: {
      profiles: scenario.requires?.profiles ?? [],
      plugins: scenario.requires?.plugins ?? [],
      capabilities: [...capabilities].toSorted(),
    },
    timeoutMs: scenario.timeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS,
    actors: Object.keys(scenario.actors ?? {}),
  };
}
