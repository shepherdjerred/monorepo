import { z } from "zod";

/**
 * Deployment allowlist of guilds where `/goal` may run, from
 * `GOAL_ALLOWED_GUILD_IDS` (comma-separated Discord guild IDs).
 *
 * The goal agent runs with full filesystem access inside the pod, so this is a
 * capability grant, not a product toggle: it stays an explicit, reviewed
 * deployment value rather than an unauthenticated runtime flag. Absent or empty
 * means no guild gets goal mode; a malformed entry fails boot.
 */
const GuildIdList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .pipe(
    z.array(z.string().regex(/^\d+$/, "guild IDs must be Discord snowflakes")),
  );

export function readGoalGuildIds(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): ReadonlySet<string> {
  const raw = env["GOAL_ALLOWED_GUILD_IDS"];
  if (raw === undefined) {
    return new Set();
  }
  const parsed = GuildIdList.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `GOAL_ALLOWED_GUILD_IDS is invalid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return new Set(parsed.data);
}
