/** Records, the store and small helpers shared by the fake service's modules. */
import { AsyncLocalStorage } from "node:async_hooks";
import { TRPCError } from "@trpc/server";
import {
  ActorSchema,
  LIMIT_DEFAULTS,
  type Actor,
  type ActorRef,
  type Anchor,
  type ArtifactKind,
  type BoardIndex,
  type CommitUploadResponse,
  type CreateUploadRequest,
  type FeedbackScope,
  type LiveMessage,
  type ThreadState,
  type Viewport,
} from "#shared/contract.ts";

export type FakeServiceOptions = {
  /** How long a human comment settles before an agent can claim it. Default 10 s. */
  readonly settleMs?: number;
  /** How long the author may edit or delete a comment that nobody claimed. Default 10 s. */
  readonly editWindowMs?: number;
  /** How long an actor must be silent before its claims can be taken over. Default 15 min. */
  readonly orphanMs?: number;
  readonly heartbeatMs?: number;
  readonly now?: () => number;
};

export type ResolvedOptions = Required<FakeServiceOptions>;

export type Origins = { readonly app: string; readonly content: string };

export type BoardRec = {
  readonly id: string;
  readonly slug: string;
  title: string;
  index: BoardIndex;
  revision: number;
  keep: boolean;
  readonly createdAt: number;
  lastActivityAt: number;
  archivedAt: number | null;
};

export type FileRec = {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly mediaType: string;
};

export type VersionRec = {
  readonly id: string;
  readonly artifactId: string;
  readonly number: number;
  readonly entryPath: string;
  readonly files: readonly FileRec[];
  readonly note: string;
  readonly viewport: Viewport | null;
  readonly createdAt: number;
  readonly publisher: ActorRef;
  token: string;
};

export type ArtifactRec = {
  readonly id: string;
  readonly boardId: string;
  title: string;
  readonly kind: ArtifactKind;
  readonly ownerKey: string;
  readonly createdAt: number;
  readonly versionIds: string[];
  currentVersionId: string | null;
};

export type DeliveryRec = {
  state: "queued" | "claimed" | "delivered" | "handled";
  actor: ActorRef | null;
  claimedAt: number | null;
  handledAt: number | null;
  attempts: number;
};

export type CommentRec = {
  readonly id: string;
  body: string;
  readonly author: ActorRef;
  readonly createdAt: number;
  updatedAt: number;
  /** Human comments only. */
  delivery: DeliveryRec | null;
};

export type ThreadRec = {
  readonly id: string;
  readonly boardId: string;
  readonly artifactId: string | null;
  readonly versionId: string | null;
  readonly anchor: Anchor;
  state: ThreadState;
  readonly createdAt: number;
  resolvedAt: number | null;
  readonly comments: CommentRec[];
};

export type UploadRec = {
  readonly id: string;
  readonly request: CreateUploadRequest;
  readonly digest: string;
  readonly expiresAt: number;
  committed: CommitUploadResponse | null;
};

export type Subscriber = {
  /** A board slug, or null for every board. */
  readonly board: string | null;
  readonly send: (message: LiveMessage) => void;
};

export type Waiter = {
  readonly actor: ActorRef;
  readonly scope: FeedbackScope;
  readonly since: number;
  readonly send: (message: LiveMessage) => void;
};

export type Store = {
  readonly options: ResolvedOptions;
  origins: Origins | null;
  seq: number;
  boards: Map<string, BoardRec>;
  artifacts: Map<string, ArtifactRec>;
  versions: Map<string, VersionRec>;
  /** Content token to version id. */
  tokens: Map<string, string>;
  blobs: Map<string, Blob>;
  threads: Map<string, ThreadRec>;
  uploads: Map<string, UploadRec>;
  uploadKeys: Map<string, string>;
  /** Actor key to the last time a request carried it. */
  seen: Map<string, number>;
  subscribers: Set<Subscriber>;
  waiters: Set<Waiter>;
};

export function resolveOptions(options: FakeServiceOptions): ResolvedOptions {
  return {
    settleMs: options.settleMs ?? LIMIT_DEFAULTS.feedbackSettleSeconds * 1000,
    editWindowMs: options.editWindowMs ?? 10_000,
    orphanMs: options.orphanMs ?? LIMIT_DEFAULTS.deliveryOrphanMinutes * 60_000,
    heartbeatMs: options.heartbeatMs ?? 8000,
    now: options.now ?? (() => Date.now()),
  };
}

/** Everything but the options and the long-lived listeners, so `reset` can start over. */
export function emptyData(): Pick<
  Store,
  | "seq"
  | "boards"
  | "artifacts"
  | "versions"
  | "tokens"
  | "blobs"
  | "threads"
  | "uploads"
  | "uploadKeys"
  | "seen"
> {
  return {
    seq: 0,
    boards: new Map(),
    artifacts: new Map(),
    versions: new Map(),
    tokens: new Map(),
    blobs: new Map(),
    threads: new Map(),
    uploads: new Map(),
    uploadKeys: new Map(),
    seen: new Map(),
  };
}

export function createStore(options: FakeServiceOptions): Store {
  return {
    options: resolveOptions(options),
    origins: null,
    ...emptyData(),
    subscribers: new Set(),
    waiters: new Set(),
  };
}

// ── Request scope ───────────────────────────────────────────────────────────

export const BROWSER_ACTOR: Actor = ActorSchema.parse({
  key: "human:jerred",
  kind: "human",
  name: "Jerred",
  metadata: { harness: "browser" },
});

export type RequestScope = {
  readonly actor: Actor;
  /** Procedure path to the document a CONFLICT must carry as `data.conflict`. */
  readonly conflicts: Map<string, unknown>;
};

export const requestScope = new AsyncLocalStorage<RequestScope>();

export function currentScope(): RequestScope {
  const scope = requestScope.getStore();
  if (scope === undefined)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "no request scope",
    });
  return scope;
}

export function currentActor(): Actor {
  return currentScope().actor;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function iso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

export function nowIso(store: Store): string {
  return iso(store.options.now());
}

export function actorRef(actor: Actor): ActorRef {
  return { key: actor.key, kind: actor.kind, name: actor.name };
}

/** The `<hostname>:<worktree>` key artifacts are owned by and a bare `wait` is scoped to. */
export function ownerKeyOf(actor: Actor): string {
  if (actor.workspaceKey !== undefined) return actor.workspaceKey;
  const { hostname, worktree } = actor.metadata;
  return hostname === undefined || worktree === undefined
    ? actor.key
    : `${hostname}:${worktree}`;
}

export function origins(store: Store): Origins {
  if (store.origins === null)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "the fake service has no origins yet; call configure()",
    });
  return store.origins;
}

export function notFound(what: string): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message: `${what} not found` });
}

export function badRequest(message: string): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message });
}

/** 24 random bytes, base64url: the content token minted at commit. */
export function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString(
    "base64url",
  );
}

export function contentUrlOf(store: Store, version: VersionRec): string {
  return `${origins(store).content}/_t/${version.token}/`;
}
