/**
 * Public scenario API. A playtest file default-exports `defineScenario({...})`:
 *
 * ```ts
 * import { defineScenario } from "@shepherdjerred/mc-harness/playtest/define.ts";
 *
 * export default defineScenario({
 *   name: "lever lights the lamp",
 *   description: "An actor pulls a lever next to a redstone lamp",
 *   actors: { alice: { at: { x: 0, y: -60, z: 0 } } },
 *   async setup({ command }) {
 *     await command("setblock 2 -60 0 minecraft:redstone_lamp");
 *   },
 *   async run({ actors: { alice }, step, expect }) {
 *     await step("place and pull the lever", async () => {
 *       await alice.place({ x: 1, y: -60, z: 0 }, "minecraft:lever[face=floor]");
 *       await alice.use({ x: 1, y: -60, z: 0 });
 *     });
 *     await expect.block({ x: 2, y: -60, z: 0 }).eventually("minecraft:redstone_lamp[lit=true]");
 *   },
 * });
 * ```
 *
 * Scenarios run in a child process against a sandbox; actors are Citizens
 * player NPCs. Assert on world state and events: messages sent to an actor
 * are not captured.
 */
import type {
  ActorObservation,
  BlockPos,
  BridgeEvent,
  CommandResponse,
  GameModeSchema,
  InfoResponse,
  WeOp,
  WeRunResponse,
  ActorActionResponse,
} from "#protocol/bridge.ts";
import type { ProfileSchema } from "#protocol/ipc.ts";
import type { z } from "zod";

// Optional fields also accept `undefined` so the runner's validated copy of a
// scenario (zod output) is still a Scenario under exactOptionalPropertyTypes.
export type ActorSpec = {
  at: BlockPos;
  gameMode?: z.infer<typeof GameModeSchema> | undefined;
  op?: boolean | undefined;
};

/** What an actor can do. Every action throws when it does not take effect; `attempt` returns instead. */
export type ActorHandle = {
  readonly name: string;
  goto: (
    pos: BlockPos,
    options?: { range?: number; timeoutMs?: number },
  ) => Promise<ActorActionResponse>;
  look: (pos: BlockPos) => Promise<ActorActionResponse>;
  equip: (
    item: string,
    options?: {
      count?: number;
      slot?: "hand" | "offhand" | "head" | "chest" | "legs" | "feet";
    },
  ) => Promise<ActorActionResponse>;
  command: (command: string) => Promise<ActorActionResponse>;
  chat: (message: string) => Promise<ActorActionResponse>;
  break: (pos: BlockPos) => Promise<ActorActionResponse>;
  place: (pos: BlockPos, block: string) => Promise<ActorActionResponse>;
  use: (pos: BlockPos) => Promise<ActorActionResponse>;
  attack: (
    target: { entity: string } | { type: string },
  ) => Promise<ActorActionResponse>;
  observe: () => Promise<ActorObservation>;
  /** Runs an action and returns its response even when `ok` is false. */
  attempt: (
    action:
      | "goto"
      | "look"
      | "equip"
      | "command"
      | "chat"
      | "break"
      | "place"
      | "use"
      | "attack",
    request: Record<string, unknown>,
  ) => Promise<ActorActionResponse>;
};

export type EventMatch = {
  type?: BridgeEvent["type"];
  player?: string;
  text?: RegExp | string;
};

export type Within = { within: (ms?: number) => Promise<BridgeEvent> };

export type Expect = {
  /** `state` matches when ids agree and every property it names agrees (`minecraft:lever[powered=true]`). */
  block: (
    pos: BlockPos,
    world?: string,
  ) => {
    toBe: (state: string) => Promise<void>;
    eventually: (
      state: string,
      options?: { within?: number; every?: number },
    ) => Promise<void>;
  };
  /** Runs a console command and matches its joined output. */
  command: (command: string) => { toMatch: (pattern: RegExp) => Promise<void> };
  /** An event recorded since the current step began (or `since`). */
  event: (match: EventMatch, options?: { since?: number }) => Within;
  chat: (actor: ActorHandle | string, text: RegExp | string) => Within;
  log: (text: RegExp | string) => Within;
  inventory: (actor: ActorHandle) => {
    toContain: (item: string, count?: number) => Promise<void>;
  };
  /** Records a plain boolean check. */
  that: (description: string, passed: boolean, detail?: string) => void;
};

export type ScenarioContext<Names extends string> = {
  /** The world actors spawn in and block expectations default to. */
  world: string;
  target: { id: string; info: () => Promise<InfoResponse> };
  command: (command: string) => Promise<CommandResponse>;
  /** WorldEdit ops in `world` as session `playtest`; throws when any op fails. */
  we: (ops: WeOp | WeOp[]) => Promise<WeRunResponse>;
  actors: Record<Names, ActorHandle>;
  events: {
    /** The newest event sequence number. */
    cursor: () => Promise<number>;
    since: (cursor: number) => Promise<BridgeEvent[]>;
  };
  step: <T>(name: string, run: () => Promise<T>) => Promise<T>;
  expect: Expect;
  sleep: (ms: number) => Promise<void>;
  /** Adds a line to the report. */
  note: (message: string) => void;
};

export type Scenario<Names extends string = string> = {
  name: string;
  description?: string | undefined;
  requires?:
    | {
        profiles?: z.infer<typeof ProfileSchema>[] | undefined;
        plugins?: string[] | undefined;
        capabilities?: ("worldedit" | "citizens")[] | undefined;
      }
    | undefined;
  /** World for actors and block expectations (default `world`). */
  world?: string | undefined;
  actors?: Record<Names, ActorSpec> | undefined;
  /** Snapshotted before and after the run into region-before/after.schem. */
  region?: { min: BlockPos; max: BlockPos } | undefined;
  /** Whole-run deadline including setup (default 120000). */
  timeoutMs?: number | undefined;
  setup?: ((context: ScenarioContext<Names>) => Promise<void>) | undefined;
  run: (context: ScenarioContext<Names>) => Promise<void>;
};

/** Marks a module's default export as a scenario; the runner validates it. */
export function defineScenario<const Names extends string>(
  scenario: Scenario<Names>,
): Scenario<Names> {
  return scenario;
}
