import { prisma, type Db } from "#src/database/index.ts";
import { recordAudit, type RecordAuditInput } from "#src/lib/audit/index.ts";

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
 * Insert a mutation's audit row inside a transaction the caller already owns.
 *
 * Split out of {@link runAuditedMutation} because not every audited mutation
 * gets to open its own transaction: confirming a prepared confirmation intent
 * has to make the single-use claim the *first* statement of the transaction
 * (that guarded write is the entire double-spend guard), so the claim helper
 * owns the transaction and this records the audit row into it. Both callers
 * share one mapping from ctx to audit row rather than restating it.
 *
 * A `null` detail records nothing, e.g. when the mutation was a no-op.
 */
export async function recordMutationAudit(params: {
  ctx: AuditedMutationCtx;
  guildId: string;
  tx: Db;
  detail: AuditDetail | null;
}): Promise<void> {
  if (params.detail === null) return;
  await recordAudit(
    {
      ...params.detail,
      actorDiscordId: params.ctx.user.discordId,
      serverId: params.guildId,
      ipAddress: params.ctx.webSession.ipAddress,
      userAgent: params.ctx.webSession.userAgent,
    },
    params.tx,
  );
}

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
    await recordMutationAudit({ ctx, guildId, tx, detail: audit(result) });
    return result;
  });
}
