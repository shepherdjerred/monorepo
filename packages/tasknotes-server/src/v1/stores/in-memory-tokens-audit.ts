import {
  computeFieldChanges,
  decodeMutationCursor,
  encodeMutationCursor,
  recordMutationMetric,
  toRecordSnapshot,
} from "../audit-diff.ts";
import type {
  ActorKind,
  ApiTokenSummary,
  AuditContext,
  AuthenticatedApiToken,
  CreateApiTokenInput,
  ListMutationsFilter,
  MutationAction,
  MutationEntityType,
  MutationEventRecord,
  MutationPage,
  TokenScope,
} from "../auth-types.ts";
import type { MonotonicClock } from "./in-memory-helpers.ts";

export type StoredApiToken = {
  id: string;
  userId: string;
  name: string;
  actorKind: ActorKind;
  tokenPrefix: string;
  tokenHash: string;
  scopes: TokenScope[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
};

export type StoredMutationEvent = {
  record: MutationEventRecord;
  syncSeq: bigint;
  createdAt: Date;
};

function toMemoryTokenSummary(token: StoredApiToken): ApiTokenSummary {
  return {
    id: token.id,
    user_id: token.userId,
    name: token.name,
    actor_kind: token.actorKind,
    token_prefix: token.tokenPrefix,
    scopes: [...token.scopes],
    expires_at: token.expiresAt === null ? null : token.expiresAt.toISOString(),
    revoked_at: token.revokedAt === null ? null : token.revokedAt.toISOString(),
    last_used_at:
      token.lastUsedAt === null ? null : token.lastUsedAt.toISOString(),
    created_at: token.createdAt.toISOString(),
  };
}

export function recordInMemoryMutation(
  events: Map<string, StoredMutationEvent>,
  clock: MonotonicClock,
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
): void {
  const { audit } = params;
  if (audit === undefined) {
    return;
  }
  const now = clock.now();
  const id = crypto.randomUUID();
  const beforeRec = toRecordSnapshot(params.before);
  const afterRec = toRecordSnapshot(params.after);
  const changes = computeFieldChanges(beforeRec, afterRec);

  const record: MutationEventRecord = {
    id,
    user_id: params.userId,
    sync_seq: String(params.syncSeq),
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    source: audit.source,
    command_uuid: audit.commandUuid ?? null,
    request_id: audit.requestId,
    actor_kind: audit.actorKind,
    actor_name: audit.actorName,
    token_id: audit.tokenId,
    token_prefix: audit.tokenPrefix,
    actor_metadata:
      audit.actorMetadata === undefined
        ? null
        : toRecordSnapshot(audit.actorMetadata),
    changes,
    before: beforeRec,
    after: afterRec,
    created_at: now.toISOString(),
  };

  events.set(id, {
    record,
    syncSeq: params.syncSeq,
    createdAt: now,
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

export function createInMemoryApiToken(
  tokens: Map<string, StoredApiToken>,
  clock: MonotonicClock,
  data: CreateApiTokenInput,
): ApiTokenSummary {
  for (const existing of tokens.values()) {
    if (existing.tokenHash === data.tokenHash) {
      throw new Error("Duplicate API token hash");
    }
  }
  const id = data.id ?? crypto.randomUUID();
  const now = clock.now();
  const stored: StoredApiToken = {
    id,
    userId: data.userId,
    name: data.name,
    actorKind: data.actorKind ?? "agent",
    tokenPrefix: data.tokenPrefix,
    tokenHash: data.tokenHash,
    scopes: [...(data.scopes ?? ["read", "write"])],
    expiresAt: data.expiresAt ?? null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: now,
  };
  tokens.set(id, stored);
  return toMemoryTokenSummary(stored);
}

export function listInMemoryApiTokens(
  tokens: Map<string, StoredApiToken>,
  userId: string,
  options?: { includeRevoked?: boolean | undefined },
): ApiTokenSummary[] {
  const matched: StoredApiToken[] = [];
  for (const token of tokens.values()) {
    if (token.userId !== userId) {
      continue;
    }
    if (options?.includeRevoked !== true && token.revokedAt !== null) {
      continue;
    }
    matched.push(token);
  }
  matched.sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
  );
  return matched.map((item) => toMemoryTokenSummary(item));
}

export function revokeInMemoryApiToken(
  tokens: Map<string, StoredApiToken>,
  clock: MonotonicClock,
  id: string,
  userId: string,
): ApiTokenSummary | null {
  const existing = tokens.get(id);
  if (existing?.userId !== userId) {
    return null;
  }
  existing.revokedAt ??= clock.now();
  return toMemoryTokenSummary(existing);
}

export function authenticateInMemoryApiToken(
  tokens: Map<string, StoredApiToken>,
  clock: MonotonicClock,
  tokenHash: string,
): AuthenticatedApiToken | null {
  const now = clock.now();
  for (const token of tokens.values()) {
    if (token.tokenHash !== tokenHash) {
      continue;
    }
    if (token.revokedAt !== null) {
      return null;
    }
    if (
      token.expiresAt !== null &&
      token.expiresAt.getTime() <= now.getTime()
    ) {
      return null;
    }
    token.lastUsedAt = now;
    return {
      id: token.id,
      userId: token.userId,
      name: token.name,
      actorKind: token.actorKind,
      tokenPrefix: token.tokenPrefix,
      scopes: [...token.scopes],
    };
  }
  return null;
}

function matchesFieldFilters(
  rec: MutationEventRecord,
  filter: ListMutationsFilter,
): boolean {
  return (
    rec.user_id === filter.userId &&
    (filter.tokenId === undefined ||
      filter.tokenId === "" ||
      rec.token_id === filter.tokenId) &&
    (filter.actorKind === undefined || rec.actor_kind === filter.actorKind) &&
    (filter.actorName === undefined ||
      filter.actorName === "" ||
      rec.actor_name === filter.actorName) &&
    matchesEntityFilters(rec, filter)
  );
}

function matchesEntityFilters(
  rec: MutationEventRecord,
  filter: ListMutationsFilter,
): boolean {
  return (
    (filter.entityType === undefined ||
      rec.entity_type === filter.entityType) &&
    (filter.entityId === undefined ||
      filter.entityId === "" ||
      rec.entity_id === filter.entityId) &&
    (filter.action === undefined || rec.action === filter.action) &&
    (filter.source === undefined || rec.source === filter.source)
  );
}

function matchesRangeAndCursor(
  entry: StoredMutationEvent,
  filter: ListMutationsFilter,
  cursor: { createdAt: Date; id: string } | null,
): boolean {
  if (
    filter.since !== undefined &&
    entry.createdAt.getTime() < filter.since.getTime()
  ) {
    return false;
  }
  if (filter.sinceSeq !== undefined && entry.syncSeq <= filter.sinceSeq) {
    return false;
  }
  if (cursor === null) {
    return true;
  }
  const timeDiff = entry.createdAt.getTime() - cursor.createdAt.getTime();
  return timeDiff < 0 || (timeDiff === 0 && entry.record.id < cursor.id);
}

export function listInMemoryMutations(
  events: Map<string, StoredMutationEvent>,
  filter: ListMutationsFilter,
): MutationPage {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const cursor = decodeMutationCursor(filter.cursor);
  const matched: StoredMutationEvent[] = [];

  for (const entry of events.values()) {
    if (
      matchesFieldFilters(entry.record, filter) &&
      matchesRangeAndCursor(entry, filter, cursor)
    ) {
      matched.push(entry);
    }
  }

  matched.sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() ||
      b.record.id.localeCompare(a.record.id),
  );

  const hasMore = matched.length > limit;
  const slice = hasMore ? matched.slice(0, limit) : matched;
  const items = slice.map((item) => structuredClone(item.record));
  const last = items.at(-1);

  return {
    items,
    next_cursor:
      hasMore && last !== undefined ? encodeMutationCursor(last) : null,
  };
}
