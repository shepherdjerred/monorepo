import { z } from "zod";
import type { RconClient } from "#e2e/harness/rcon.ts";
import wire from "#learning-load-wire";

const count = z.number().int().nonnegative();
export const InferenceMetrics = z
  .object({
    inference: z
      .object({
        submitted: count,
        skipped: count,
        timely: count,
        stale: count,
        expired: count,
        contextDrops: count,
        deadlineMet: count,
        deadlineMissed: count,
        resets: count,
        rejected: count,
        hits: count,
        misses: count,
        maximumNanos: count,
        maximumBatch: count.max(100),
      })
      .strict(),
    delivery: z
      .object({ applied: count, unavailable: count, ineligible: count })
      .strict(),
  })
  .strict();
const fields = Object.keys(InferenceMetrics.shape.inference.shape);
if (
  fields.length !== wire.inferenceFields.length ||
  new Set(wire.inferenceFields).size !== wire.inferenceFields.length ||
  wire.inferenceFields.some((field) => !fields.includes(field))
)
  throw new Error("inference metrics differ from wire contract");
const State = z
  .object({ state: z.enum(["empty", "loading", "ready"]) })
  .strict();

/** Disposable diagnostics only; this command is absent from the production plugin. */
export class InferenceClient {
  constructor(private readonly rcon: RconClient) {}

  private async command(command: string): Promise<unknown> {
    const response = await this.rcon.command(`rwfinfer ${command}`);
    const reply: unknown = JSON.parse(response.trim());
    const error = z.object({ error: z.string() }).strict().safeParse(reply);
    if (error.success) throw new Error(error.data.error);
    return reply;
  }

  async load(): Promise<void> {
    State.parse(await this.command("load"));
    const deadline = Date.now() + 30_000;
    do {
      if (State.parse(await this.command("state")).state === "ready") return;
      await Bun.sleep(50);
    } while (Date.now() < deadline);
    throw new Error("Java diagnostic actor loading timed out");
  }

  async begin(
    seed: number,
    side: "red" | "blue",
    opponent: "authored" | "basic",
  ): Promise<void> {
    const validated = z
      .object({
        seed: z.number().int().min(0).max(1_000_000_000),
        side: z.enum(["red", "blue"]),
        opponent: z.enum(["authored", "basic"]),
      })
      .strict()
      .parse({ seed, side, opponent });
    const state = State.parse(
      await this.command(
        `begin ${validated.seed.toString()} ${validated.side} ${validated.opponent}`,
      ),
    );
    if (state.state !== "ready")
      throw new Error("Java diagnostic actor is not ready");
  }

  async metrics() {
    return z
      .object({ metrics: InferenceMetrics })
      .strict()
      .parse(await this.command("metrics")).metrics;
  }
}
