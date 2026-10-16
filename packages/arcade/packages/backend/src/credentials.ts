import { z } from "zod";

const CredentialsSchema = z.strictObject({
  botToken: z.string().trim().min(1),
  applicationId: z.string().regex(/^\d+$/),
  streamingTokens: z
    .array(z.string().trim().min(1))
    .min(1)
    .refine((tokens) => new Set(tokens).size === tokens.length),
});

/** Credentials are bootstrap inputs; runtime behavior belongs in typed config. */
export function readCredentials(
  env: Readonly<Record<string, string | undefined>>,
) {
  let streamingTokens: unknown;
  try {
    streamingTokens = JSON.parse(env["DISCORD_STREAMING_TOKENS"] ?? "null");
  } catch {
    throw new Error(
      "DISCORD_STREAMING_TOKENS must be a JSON array of distinct tokens",
    );
  }
  const result = CredentialsSchema.safeParse({
    botToken: env["DISCORD_BOT_TOKEN"],
    applicationId: env["DISCORD_APPLICATION_ID"],
    streamingTokens,
  });
  // Validation errors must never contain a token or a raw credential input.
  if (!result.success)
    throw new Error(
      "Arcade requires a bot token, application ID, and distinct streaming tokens",
    );
  return result.data;
}

export async function startArcadePool(
  pool: {
    start: () => Promise<void>;
    size: () => number;
    userIds: () => ReadonlySet<string>;
  },
  excludedIds: Set<string>,
) {
  await pool.start();
  const ids = pool.userIds();
  if (ids.size !== pool.size())
    throw new Error(
      "Arcade streaming pool contains duplicate Discord accounts",
    );
  for (const id of ids) excludedIds.add(id);
}
