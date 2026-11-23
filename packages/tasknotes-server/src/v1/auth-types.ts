import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000000";
export const API_TOKEN_PREFIX = "fct_";
export const ACTOR_METADATA_HEADER = "x-facet-actor-metadata";

export const ActorKindSchema = z.enum(["human", "agent"]);
export type ActorKind = z.infer<typeof ActorKindSchema>;

export const TokenScopeSchema = z.enum(["read", "write"]);
export type TokenScope = z.infer<typeof TokenScopeSchema>;

export const MutationSourceSchema = z.enum(["sync", "rest", "mcp"]);
export type MutationSource = z.infer<typeof MutationSourceSchema>;

export const MutationEntityTypeSchema = z.enum([
  "task",
  "project",
  "section",
  "label",
  "reminder",
  "filter",
]);
export type MutationEntityType = z.infer<typeof MutationEntityTypeSchema>;

export const MutationActionSchema = z.enum([
  "create",
  "update",
  "complete",
  "uncomplete",
  "delete",
  "restore",
  "move",
  "reschedule",
  "reorder",
  "comment_add",
  "comment_delete",
  "attachment_remove",
]);
export type MutationAction = z.infer<typeof MutationActionSchema>;

export const ActorMetadataSchema = z.strictObject({
  model: z.string().trim().min(1).max(200).optional(),
  harness: z.string().trim().min(1).max(200).optional(),
  session_id: z.string().trim().min(1).max(200).optional(),
  client_name: z.string().trim().min(1).max(200).optional(),
  client_version: z.string().trim().min(1).max(100).optional(),
  reason: z.string().trim().min(1).max(1000).optional(),
});
export type ActorMetadata = z.infer<typeof ActorMetadataSchema>;

export type AuthPrincipal =
  | {
      kind: "admin";
      actorKind: "human";
      actorName: string;
      scopes: readonly TokenScope[];
      tokenId: null;
      tokenPrefix: null;
      userId: null;
    }
  | {
      kind: "api_token";
      actorKind: ActorKind;
      actorName: string;
      scopes: readonly TokenScope[];
      tokenId: string;
      tokenPrefix: string;
      userId: string;
    };

export const DEFAULT_ADMIN_PRINCIPAL: AuthPrincipal = {
  kind: "admin",
  actorKind: "human",
  actorName: "Owner",
  scopes: ["read", "write"],
  tokenId: null,
  tokenPrefix: null,
  userId: null,
};

export type AuditContext = {
  actorKind: ActorKind;
  actorName: string;
  tokenId: string | null;
  tokenPrefix: string | null;
  actorMetadata?: ActorMetadata | undefined;
  source: MutationSource;
  requestId: string;
  commandUuid?: string | undefined;
  actionHint?: MutationAction | undefined;
};

export type ApiTokenSummary = {
  id: string;
  user_id: string;
  name: string;
  actor_kind: ActorKind;
  token_prefix: string;
  scopes: TokenScope[];
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

export type AuthenticatedApiToken = {
  id: string;
  userId: string;
  name: string;
  actorKind: ActorKind;
  tokenPrefix: string;
  scopes: TokenScope[];
};

export type CreateApiTokenInput = {
  id?: string | undefined;
  userId: string;
  name: string;
  actorKind?: ActorKind | undefined;
  tokenPrefix: string;
  tokenHash: string;
  scopes?: TokenScope[] | undefined;
  expiresAt?: Date | null | undefined;
};

export type FieldChange = {
  from: unknown;
  to: unknown;
};

export type MutationEventRecord = {
  id: string;
  user_id: string;
  sync_seq: string;
  entity_type: MutationEntityType;
  entity_id: string;
  action: MutationAction;
  source: MutationSource;
  command_uuid: string | null;
  request_id: string;
  actor_kind: ActorKind;
  actor_name: string;
  token_id: string | null;
  token_prefix: string | null;
  actor_metadata: Record<string, unknown> | null;
  changes: Record<string, FieldChange>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
};

export type ListMutationsFilter = {
  userId: string;
  tokenId?: string | undefined;
  actorKind?: ActorKind | undefined;
  actorName?: string | undefined;
  entityType?: MutationEntityType | undefined;
  entityId?: string | undefined;
  action?: MutationAction | undefined;
  source?: MutationSource | undefined;
  since?: Date | undefined;
  sinceSeq?: bigint | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
};

export type MutationPage = {
  items: MutationEventRecord[];
  next_cursor: string | null;
};

export function hashApiToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function generateApiToken(): {
  rawToken: string;
  tokenPrefix: string;
  tokenHash: string;
} {
  const secret = randomBytes(32).toString("base64url");
  const rawToken = `${API_TOKEN_PREFIX}${secret}`;
  return {
    rawToken,
    tokenPrefix: rawToken.slice(0, 12),
    tokenHash: hashApiToken(rawToken),
  };
}

export function verifyBootstrapToken(
  candidate: string,
  expected: string,
): boolean {
  if (expected === "" || candidate === "") {
    return false;
  }
  const candidateDigest = createHash("sha256")
    .update(candidate, "utf8")
    .digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

export function extractBearerToken(
  authorizationHeader: string | undefined,
): string | null {
  if (authorizationHeader === undefined) {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim());
  return match?.[1] ?? null;
}

export function parseActorMetadataHeader(
  rawHeader: string | undefined,
):
  | { ok: true; metadata: ActorMetadata | undefined }
  | { ok: false; error: string } {
  if (rawHeader === undefined || rawHeader.trim() === "") {
    return { ok: true, metadata: undefined };
  }
  if (rawHeader.length > 4096) {
    return { ok: false, error: `${ACTOR_METADATA_HEADER} exceeds 4096 bytes` };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawHeader);
  } catch {
    return { ok: false, error: `${ACTOR_METADATA_HEADER} must be valid JSON` };
  }
  const parsed = ActorMetadataSchema.safeParse(decoded);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "invalid metadata";
    return { ok: false, error: `Invalid ${ACTOR_METADATA_HEADER}: ${first}` };
  }
  return { ok: true, metadata: parsed.data };
}

export function buildAuditContext(options: {
  principal: AuthPrincipal;
  source: MutationSource;
  requestId: string;
  actorMetadata?: ActorMetadata | undefined;
  commandUuid?: string | undefined;
  actionHint?: MutationAction | undefined;
}): AuditContext {
  return {
    actorKind: options.principal.actorKind,
    actorName: options.principal.actorName,
    tokenId: options.principal.tokenId,
    tokenPrefix: options.principal.tokenPrefix,
    actorMetadata: options.actorMetadata,
    source: options.source,
    requestId: options.requestId,
    commandUuid: options.commandUuid,
    actionHint: options.actionHint,
  };
}
