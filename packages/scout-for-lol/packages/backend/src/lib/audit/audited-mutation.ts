import { prisma } from "#src/database/index.ts";
import {
  recordAudit,
  type Db,
  type RecordAuditInput,
} from "#src/lib/audit/index.ts";

/**
 * Minimal shape of the tRPC web context this helper needs: the acting user
 * and the request-derived session metadata that every audit row records.
 * Structurally compatible with the post-auth `webMutationProcedure` ctx.
 */
export type AuditedMutationCtx = {
  user: { discordId: string };
  webSession: { ipAddress: string | null; userAgent: string | null };
};

/**
 * The mutation-specific portion of an audit row. The actor, server, and
 * request metadata are filled in by {@link runAuditedMutation} from ctx.
 */
export type AuditDetail = Pick<
  RecordAuditInput,
  | "action"
  | "targetChannelId"
  | "targetPlayerId"
  | "targetAccountId"
  | "payload"
>;

/**
 * Run a state-changing domain mutation and its audit-row insert inside a
 * single Prisma transaction so they commit atomically — either both land or
 * neither does.
 *
 * `run` performs the domain mutation against the transaction client and
 * returns its result. `audit` inspects that result and returns the
 * mutation-specific audit fields to record, or `null` to skip the audit row
 * (e.g. when the mutation was a no-op). The actor, server, and request
 * metadata common to every audit row are supplied from `ctx` and `guildId`.
 */
export async function runAuditedMutation<TResult>(
  ctx: AuditedMutationCtx,
  guildId: string,
  run: (tx: Db) => Promise<TResult>,
  audit: (result: TResult) => AuditDetail | null,
): Promise<TResult> {
  return prisma.$transaction(async (tx) => {
    const result = await run(tx);
    const detail = audit(result);
    if (detail !== null) {
      await recordAudit(
        {
          ...detail,
          actorDiscordId: ctx.user.discordId,
          serverId: guildId,
          ipAddress: ctx.webSession.ipAddress,
          userAgent: ctx.webSession.userAgent,
        },
        tx,
      );
    }
    return result;
  });
}
