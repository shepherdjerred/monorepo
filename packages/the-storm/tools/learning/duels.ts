import { z } from "zod";
import type { RconClient } from "#e2e/harness/rcon.ts";
import protocol from "#learning-wire";

const OpponentFrameSchema = z
  .object({
    body: z.uuid(),
    life: z.number().int().nonnegative(),
    tick: z.number().int().nonnegative(),
    used: z.array(z.number().int().nonnegative()).max(4),
    applied: z.number().int().nonnegative(),
    fallback: z.number().int().nonnegative(),
    observation: z.array(z.number().min(-1).max(1)).length(34).optional(),
  })
  .strict();

export const DuelStateSchema = z
  .object({
    protocol: z.literal(protocol.version),
    contract: z.literal(protocol.contract),
    seed: z.number().int(),
    side: z.enum(["red", "blue"]),
    mode: z.enum(["authored", "external"]),
    opponent: z.enum(protocol.opponents),
    result: z.enum(protocol.results),
    phase: z.enum(protocol.phases),
    match: z.union([z.uuid(), z.literal("")]),
    dealt: z.number().nonnegative(),
    received: z.number().nonnegative(),
    sampleDealt: z.number().nonnegative(),
    sampleReceived: z.number().nonnegative(),
    sampleTick: z.number().int().nonnegative(),
    used: z.array(z.number().int().nonnegative()).max(4),
    applied: z.number().int().nonnegative(),
    fallback: z.number().int().nonnegative(),
    body: z.uuid().optional(),
    life: z.number().int().nonnegative().optional(),
    tick: z.number().int().nonnegative().optional(),
    elapsed: z.number().int().nonnegative().optional(),
    hp: z.number().min(0).max(20).optional(),
    observation: z.array(z.number().min(-1).max(1)).length(34).optional(),
    opponentFrame: OpponentFrameSchema.optional(),
  })
  .strict();
export type DuelState = z.infer<typeof DuelStateSchema>;

if (
  protocol.version !== 3 ||
  protocol.contract !== "rwf-combat-v1" ||
  new Set([...protocol.required, ...protocol.optional]).size !==
    Object.keys(DuelStateSchema.shape).length ||
  [...protocol.required, ...protocol.optional].some(
    (key) => !(key in DuelStateSchema.shape),
  ) ||
  new Set([...protocol.frameRequired, ...protocol.frameOptional]).size !==
    Object.keys(OpponentFrameSchema.shape).length ||
  [...protocol.frameRequired, ...protocol.frameOptional].some(
    (key) => !(key in OpponentFrameSchema.shape),
  )
) {
  throw new Error("duel validator fields differ from wire contract");
}

export const ActionSchema = z
  .object({
    move: z.number().int().min(0).max(8),
    jump: z.boolean(),
    sneak: z.boolean(),
    sprint: z.boolean(),
    attack: z.boolean(),
  })
  .strict();
export type CombatAction = z.infer<typeof ActionSchema>;

/** One authenticated console request. The sandbox fixture keeps all game work on Paper's thread. */
export class DuelClient {
  constructor(private readonly rcon: RconClient) {}

  async command(command: string): Promise<DuelState> {
    const response = await this.rcon.command(`rwflearn ${command}`);
    const reply: unknown = JSON.parse(response.trim());
    const error = z.object({ error: z.string() }).safeParse(reply);
    if (error.success) throw new Error(error.data.error);
    return DuelStateSchema.parse(reply);
  }

  async action(context: DuelState, input: CombatAction): Promise<DuelState> {
    const action = ActionSchema.parse(input);
    if (
      context.body === undefined ||
      context.life === undefined ||
      context.tick === undefined ||
      context.result !== "live"
    ) {
      throw new Error("action needs a live observation context");
    }
    return this.command(
      [
        "act",
        context.match,
        context.body,
        context.life,
        context.tick,
        action.move,
        Number(action.jump),
        Number(action.sneak),
        Number(action.sprint),
        Number(action.attack),
      ].join(" "),
    );
  }

  async waitFor(
    predicate: (state: DuelState) => boolean,
    timeoutMs: number,
  ): Promise<DuelState> {
    const deadline = Date.now() + timeoutMs;
    do {
      const state = await this.command("state");
      if (predicate(state)) return state;
      await Bun.sleep(50);
    } while (Date.now() < deadline);
    throw new Error("Paper duel state timed out");
  }
}
