import { z } from "zod";
import {
  isCredentiallessFlagsRequest,
  ProdDeploymentSchema,
} from "./brain/flags.ts";

const EvaluationSchema = z.strictObject({
  deployment: ProdDeploymentSchema,
  key: z.literal("the-storm-beginners-luck-enabled"),
  context: z.strictObject({ user: z.uuid() }),
});

/** Per-player, default-off Flags double, confined to disposable acceptance servers. */
export class BeginnerFlags {
  private players = new Set<string>();

  async evaluate(request: Request): Promise<Response | undefined> {
    const body: unknown = await request.json();
    const parsed = EvaluationSchema.safeParse(body);
    return parsed.success && isCredentiallessFlagsRequest(request)
      ? Response.json({ enabled: this.players.has(parsed.data.context.user) })
      : undefined;
  }

  async control(request: Request): Promise<Response> {
    if (request.method !== "POST")
      return new Response("not found", { status: 404 });
    const body: unknown = await request.json();
    const parsed = z.array(z.uuid()).safeParse(body);
    if (!parsed.success)
      return new Response("invalid players", { status: 400 });
    this.players = new Set(parsed.data);
    return Response.json({ players: parsed.data });
  }
}
