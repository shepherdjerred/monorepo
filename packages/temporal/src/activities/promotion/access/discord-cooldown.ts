import { z } from "zod/v4";

export const DiscordCooldown = z.strictObject({
  code: z.literal("DISCORD_COOLDOWN"),
  effect: z.literal("not-sent"),
  error: z.string(),
  retryAfterMs: z.number().int().positive(),
  nextEligibleAt: z.iso.datetime(),
});

export class DiscordCooldownError extends Error {
  constructor(readonly cooldown: z.infer<typeof DiscordCooldown>) {
    super(cooldown.error);
  }
}

export async function throwDiscordCooldown(response: Response, path: string) {
  if (response.status === 429 && (path === "/send" || path === "/slash")) {
    const parsed = DiscordCooldown.safeParse(await response.json());
    if (parsed.success) throw new DiscordCooldownError(parsed.data);
  }
}
