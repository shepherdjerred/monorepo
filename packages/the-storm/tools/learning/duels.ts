import { z } from "zod";
import type { RconClient } from "#e2e/harness/rcon.ts";

export const DuelStateSchema = z
  .object({
    protocol: z.literal(1),
    contract: z.literal("rwf-combat-v1"),
    seed: z.number().int(),
    side: z.enum(["red", "blue"]),
    mode: z.enum(["authored", "external"]),
    result: z.enum([
      "waiting",
      "live",
      "win",
      "loss",
      "draw",
      "timeout",
      "stopped",
      "cancelled",
    ]),
    phase: z.enum(["LOBBY", "COUNTDOWN", "LIVE", "ENDED", "RESETTING"]),
    match: z.union([z.uuid(), z.literal("")]),
    dealt: z.number().nonnegative(),
    received: z.number().nonnegative(),
    applied: z.number().int().nonnegative(),
    fallback: z.number().int().nonnegative(),
    body: z.uuid().optional(),
    life: z.number().int().nonnegative().optional(),
    tick: z.number().int().nonnegative().optional(),
    elapsed: z.number().int().nonnegative().optional(),
    hp: z.number().min(0).max(20).optional(),
    observation: z.array(z.number().min(-1).max(1)).length(34).optional(),
  })
  .strict();
export type DuelState = z.infer<typeof DuelStateSchema>;

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
