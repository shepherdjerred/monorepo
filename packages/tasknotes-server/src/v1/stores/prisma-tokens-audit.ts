import { Prisma, type PrismaClient } from "#generated/prisma/client.ts";
import { z } from "zod";
import {
  computeFieldChanges,
  decodeMutationCursor,
  encodeMutationCursor,
  recordMutationMetric,
  toRecordSnapshot,
} from "../audit-diff.ts";
import {
  ActorKindSchema,
  type ApiTokenSummary,
  type AuditContext,
  type AuthenticatedApiToken,
  type CreateApiTokenInput,
  type FieldChange,
  type ListMutationsFilter,
  MutationActionSchema,
  type MutationAction,
  MutationEntityTypeSchema,
  type MutationEntityType,
  type MutationEventRecord,
  type MutationPage,
  MutationSourceSchema,
  TokenScopeSchema,
  type TokenScope,
} from "../auth-types.ts";

type PrismaDb = PrismaClient | Prisma.TransactionClient;

const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean()]);
const RecordJsonSchema = z.record(z.string(), z.unknown());
const FieldChangesJsonSchema = z.record(
  z.string(),
  z.object({
    from: z.unknown(),
    to: z.unknown(),
  }),
);

export function toInputJson(value: unknown): Prisma.InputJsonValue {
  const primitive = JsonPrimitiveSchema.safeParse(value);
  if (primitive.success) {
    return primitive.data;
  }
  if (Array.isArray(value)) {
    return value.map((item) => (item === null ? null : toInputJson(item)));
  }
  const obj = RecordJsonSchema.safeParse(value);
  if (obj.success) {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, entry] of Object.entries(obj.data)) {
      if (entry !== undefined) {
        out[key] = entry === null ? null : toInputJson(entry);
      }
    }
    return out;
  }
  return String(value);
}

function parseScopes(raw: readonly string[]): TokenScope[] {
  const scopes: TokenScope[] = [];
  for (const item of raw) {
    const parsed = TokenScopeSchema.parse(item);
    if (!scopes.includes(parsed)) {
      scopes.push(parsed);
    }
  }
  return scopes;
}

function toApiTokenSummary(row: {
  id: string;
  userId: string;
  name: string;
  actorKind: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}): ApiTokenSummary {
  const actorKind = ActorKindSchema.parse(row.actorKind);
  return {
    id: row.id,
    user_id: row.userId,
    name: row.name,
    actor_kind: actorKind,
    token_prefix: row.tokenPrefix,
    scopes: parseScopes(row.scopes),
    expires_at: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    revoked_at: row.revokedAt === null ? null : row.revokedAt.toISOString(),
    last_used_at: row.lastUsedAt === null ? null : row.lastUsedAt.toISOString(),
    created_at: row.createdAt.toISOString(),
  };
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  return value === null || value === undefined
    ? null
    : RecordJsonSchema.parse(value);
}

function parseFieldChanges(value: unknown): Record<string, FieldChange> {
  const parsed = FieldChangesJsonSchema.parse(value);
  const out: Record<string, FieldChange> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    out[key] = { from: entry.from ?? null, to: entry.to ?? null };
  }
  return out;
}

export async function recordPrismaMutation(
  prisma: PrismaDb,
  params: {
    userId: string;
    syncSeq: bigint;
    entityType: MutationEntityType;
    entityId: string;
    action: MutationAction;
    audit: AuditContext | undefined;
    before: object | null;
    after: object | null;
    onCommit?: ((fn: () => void) => void) | undefined;
  },
): Promise<void> {
  const { audit } = params;
  if (audit === undefined) {
    return;
  }
  const beforeRec = toRecordSnapshot(params.before);
  const afterRec = toRecordSnapshot(params.after);
  const changes = computeFieldChanges(beforeRec, afterRec);

  await prisma.mutationEvent.create({
    data: {
      userId: params.userId,
      syncSeq: params.syncSeq,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      source: audit.source,
      commandUuid: audit.commandUuid ?? null,
      requestId: audit.requestId,
      actorKind: audit.actorKind,
      actorName: audit.actorName,
      tokenId: audit.tokenId,
      tokenPrefix: audit.tokenPrefix,
      actorMetadata:
        audit.actorMetadata === undefined
          ? Prisma.DbNull
          : toInputJson(audit.actorMetadata),
      changes: toInputJson(changes),
      before: beforeRec === null ? Prisma.DbNull : toInputJson(beforeRec),
      after: afterRec === null ? Prisma.DbNull : toInputJson(afterRec),
    },
  });
  const emit = () => {
    recordMutationMetric(params.entityType, params.action, audit);
  };
  if (params.onCommit === undefined) {
    emit();
  } else {
    params.onCommit(emit);
  }
}

export async function createPrismaApiToken(
  prisma: PrismaDb,
  data: CreateApiTokenInput,
): Promise<ApiTokenSummary> {
  await prisma.user.upsert({
    where: { id: data.userId },
    create: {
      id: data.userId,
      email: `${data.userId}@tasknotes.local`,
      name: "Default User",
    },
    update: {},
  });
  const scopes = data.scopes ?? ["read", "write"];
  const created = await prisma.apiToken.create({
    data: {
      id: data.id ?? crypto.randomUUID(),
      userId: data.userId,
      name: data.name,
      actorKind: data.actorKind ?? "agent",
      tokenPrefix: data.tokenPrefix,
      tokenHash: data.tokenHash,
      scopes,
      expiresAt: data.expiresAt ?? null,
    },
  });
  return toApiTokenSummary(created);
}

export async function listPrismaApiTokens(
  prisma: PrismaDb,
  userId: string,
  options?: { includeRevoked?: boolean | undefined },
): Promise<ApiTokenSummary[]> {
  const rows = await prisma.apiToken.findMany({
    where: {
      userId,
      ...(options?.includeRevoked === true ? {} : { revokedAt: null }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map((row) => toApiTokenSummary(row));
}

export async function revokePrismaApiToken(
  prisma: PrismaDb,
  id: string,
  userId: string,
  now: Date,
): Promise<ApiTokenSummary | null> {
  const existing = await prisma.apiToken.findFirst({
    where: { id, userId },
  });
  if (existing === null) {
    return null;
  }
  if (existing.revokedAt !== null) {
    return toApiTokenSummary(existing);
  }
  const updated = await prisma.apiToken.update({
    where: { id },
    data: { revokedAt: now },
  });
  return toApiTokenSummary(updated);
}

export async function authenticatePrismaApiToken(
  prisma: PrismaDb,
  tokenHash: string,
  now: Date,
): Promise<AuthenticatedApiToken | null> {
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash },
  });
  if (!row) {
    return null;
  }
  if (row.revokedAt !== null) {
    return null;
  }
  if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) {
    return null;
  }
  await prisma.apiToken.update({
    where: { id: row.id },
    data: { lastUsedAt: now },
  });
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    actorKind: ActorKindSchema.parse(row.actorKind),
    tokenPrefix: row.tokenPrefix,
    scopes: parseScopes(row.scopes),
  };
}

function buildPrismaMutationWhere(
  filter: ListMutationsFilter,
): Prisma.MutationEventWhereInput {
  const where: Prisma.MutationEventWhereInput = { userId: filter.userId };
  if (filter.tokenId !== undefined && filter.tokenId !== "") {
    where.tokenId = filter.tokenId;
  }
  if (filter.actorKind !== undefined) {
    where.actorKind = filter.actorKind;
  }
  if (filter.actorName !== undefined && filter.actorName !== "") {
    where.actorName = filter.actorName;
  }
  if (filter.entityType !== undefined) {
    where.entityType = filter.entityType;
  }
  if (filter.entityId !== undefined && filter.entityId !== "") {
    where.entityId = filter.entityId;
  }
  if (filter.action !== undefined) {
    where.action = filter.action;
  }
  if (filter.source !== undefined) {
    where.source = filter.source;
  }
  if (filter.since !== undefined) {
    where.createdAt = { gte: filter.since };
  }
  if (filter.sinceSeq !== undefined) {
    where.syncSeq = { gt: filter.sinceSeq };
  }
  const cursor = decodeMutationCursor(filter.cursor);
  if (cursor !== null) {
    where.OR = [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ];
  }
  return where;
}

export async function listPrismaMutations(
  prisma: PrismaDb,
  filter: ListMutationsFilter,
): Promise<MutationPage> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const rows = await prisma.mutationEvent.findMany({
    where: buildPrismaMutationWhere(filter),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const items: MutationEventRecord[] = slice.map((row) => ({
    id: row.id,
    user_id: row.userId,
    sync_seq: String(row.syncSeq),
    entity_type: MutationEntityTypeSchema.parse(row.entityType),
    entity_id: row.entityId,
    action: MutationActionSchema.parse(row.action),
    source: MutationSourceSchema.parse(row.source),
    command_uuid: row.commandUuid,
    request_id: row.requestId,
    actor_kind: ActorKindSchema.parse(row.actorKind),
    actor_name: row.actorName,
    token_id: row.tokenId,
    token_prefix: row.tokenPrefix,
    actor_metadata: parseJsonRecord(row.actorMetadata),
    changes: parseFieldChanges(row.changes),
    before: parseJsonRecord(row.before),
    after: parseJsonRecord(row.after),
    created_at: row.createdAt.toISOString(),
  }));

  const last = items.at(-1);
  return {
    items,
    next_cursor:
      hasMore && last !== undefined ? encodeMutationCursor(last) : null,
  };
}
