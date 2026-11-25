import {
  DiscordGuildIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { isPolicyEnabled, ME, MY_SERVER } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";

/** The two feature flags that gate the Scout Client. */
export type ScoutClientFlag =
  "scout_client_ingestion" | "scout_client_result_recovery";

/**
 * The rollout's first audience: the owner's account and the owner's server.
 *
 * Every production rollout step keeps this audience (owner, then the owner's
 * server, then everyone), so the flag answering false here means no one in
 * this environment has the Scout Client. Read at call time rather than module
 * load, so importing this module never depends on the flag registry.
 */
function rolloutCanary() {
  return { user: ME, server: MY_SERVER };
}

/**
 * Whether a Scout Client flag is live in this environment at all.
 *
 * Answered from Flags alone, with no database access, so a Flags `false` (no
 * rollout reaches the owner or the owner's server) closes every path before it
 * reads a device, an observation or a guild membership. Read paths that are
 * not tied to one device owner (stored client evidence for a match, a PUUID or
 * a guild) use this as their gate.
 */
export async function isScoutClientLive(
  flag: ScoutClientFlag,
): Promise<boolean> {
  return await isPolicyEnabled(flag, rolloutCanary());
}

/** Whether stored Scout Client evidence may be read or written here. */
export async function isScoutClientEvidenceLive(): Promise<boolean> {
  return await isScoutClientLive("scout_client_ingestion");
}

/**
 * Whether a Scout Client flag is on for one device owner.
 *
 * A user-targeted rule decides first, exactly as before. Otherwise the flag is
 * evaluated for each guild where the owner has a `Player`, so a rollout can
 * target the owner's server and reach every member's devices there. The guild
 * lookup is the only database read, and it runs only once the flag is live in
 * this environment: a Flags `false` answers before it.
 */
export async function isScoutClientEnabledFor(
  flag: ScoutClientFlag,
  owner: DiscordAccountId,
): Promise<boolean> {
  if (await isPolicyEnabled(flag, { user: owner })) return true;
  if (!(await isScoutClientLive(flag))) return false;
  const guilds = await prisma.player.findMany({
    where: { discordId: owner },
    select: { serverId: true },
    distinct: ["serverId"],
  });
  for (const { serverId } of guilds) {
    const server = DiscordGuildIdSchema.parse(serverId);
    if (await isPolicyEnabled(flag, { server })) return true;
  }
  return false;
}

/**
 * {@link isScoutClientEnabledFor}, memoized per owner for one bounded unit of
 * work (a reconciliation page, a metrics sweep), so a page of rows from the
 * same owner looks their guilds up once.
 */
export function scoutClientOwnerPolicy(
  flag: ScoutClientFlag,
): (owner: DiscordAccountId) => Promise<boolean> {
  const decisions = new Map<DiscordAccountId, Promise<boolean>>();
  return async (owner) => {
    let decision = decisions.get(owner);
    if (decision === undefined) {
      decision = isScoutClientEnabledFor(flag, owner);
      decisions.set(owner, decision);
    }
    return await decision;
  };
}
