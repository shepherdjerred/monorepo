import { z } from "zod";

const EvaluationSchema = z.strictObject({
  namespace_key: z.literal("the-storm"),
  flag_key: z.literal("the-storm-beginners-luck-enabled"),
  entity_id: z.uuid(),
  context: z.strictObject({}),
});

/** Per-player, default-off Flipt double, confined to disposable acceptance servers. */
export class BeginnerFlags {
  private players = new Set<string>();

  async evaluate(request: Request): Promise<Response | undefined> {
    const body: unknown = await request.json();
    const parsed = EvaluationSchema.safeParse(body);
    return parsed.success &&
      request.headers.get("x-flipt-environment") === "prod"
      ? Response.json({ enabled: this.players.has(parsed.data.entity_id) })
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
