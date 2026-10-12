import { z } from "zod";
import { createTemporalReadClient } from "#client";
import { parseTemporalNamespace } from "#shared/infra/temporal-namespace.ts";
import { stormResetNotice } from "#shared/storm-reset-notice.ts";

const DISCORD_API = "https://discord.com/api/v10";
const MINING_RESET_SCHEDULE = "the-storm-mining-reset-quarterly";

const EnvSchema = z.object({
  STORM_DISCORD_BOT_TOKEN: z.string().min(1),
  STORM_DISCORD_CHANNEL_ID: z.string().regex(/^[1-9]\d{16,19}$/),
});

/** Posts to The Storm's bridged channel. A nonce makes a retried post land once. */
export type StormPost = (content: string, nonce: string) => Promise<void>;

/** The HTTP call the poster makes; `fetch` in production. */
export type Send = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The Discord REST poster, using the bridge bot's token. Mentions are off and
 * the message is silent, like the bridge's own feed posts.
 */
export function stormDiscordPost(
  env: Record<string, string | undefined> = Bun.env,
  send: Send = (url, init) => fetch(url, init),
): StormPost {
  return async (content, nonce) => {
    const {
      STORM_DISCORD_BOT_TOKEN: token,
      STORM_DISCORD_CHANNEL_ID: channel,
    } = EnvSchema.parse(env);
    if (nonce.length > 25) throw new Error(`Discord nonce too long: ${nonce}`);
    const response = await send(`${DISCORD_API}/channels/${channel}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        nonce,
        enforce_nonce: true,
        allowed_mentions: { parse: [] },
        flags: 1 << 12,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(
        `Discord refused The Storm announcement: HTTP ${String(response.status)}`,
      );
    }
  };
}

/** Warns a week and a day before an active mining reset; quiet otherwise. */
export async function announceStormMiningResetCountdown(
  post: StormPost = stormDiscordPost(),
  now: Date = new Date(),
): Promise<"paused" | "quiet" | "posted"> {
  const client = await createTemporalReadClient(
    parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]),
  );
  const schedule = await client.schedule
    .getHandle(MINING_RESET_SCHEDULE)
    .describe();
  if (schedule.state.paused) return "paused";
  const notice = stormResetNotice(
    now,
    schedule.info.nextActionTimes[0],
    schedule.state.paused,
  );
  if (notice === null) return "quiet";
  await post(notice.content, notice.nonce);
  return "posted";
}

export const stormDiscordActivities = {
  announceStormMiningResetCountdown: () => announceStormMiningResetCountdown(),
  announceStormMiningResetDone: (period: string) =>
    stormDiscordPost()(
      `The mining world has been reset (${period}). Fresh ores await.`,
      `rst-done-${period}`,
    ),
};
export type StormDiscordActivities = typeof stormDiscordActivities;
