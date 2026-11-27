import { ActorSchema, type Actor } from "#shared/contract.ts";
import type { Database } from "#infrastructure/database.ts";
import { ArtifactsError } from "./errors.ts";
import type { Caller } from "./types.ts";

const MAX_HEADER_CHARS = 16_000;

/** `<hostname>:<worktree>` from metadata when the caller names no workspace. */
export function deriveWorkspaceKey(actor: Actor): string | null {
  if (actor.workspaceKey !== undefined) return actor.workspaceKey;
  const { hostname, worktree } = actor.metadata;
  return hostname === undefined || worktree === undefined
    ? null
    : `${hostname}:${worktree}`;
}

/**
 * Reads `X-Artifacts-Actor`: base64 JSON of an `ActorSchema`. Only agents and
 * runners may use it, and not under the browser's `human:` namespace, so a
 * header can never author human feedback.
 */
export function parseActorHeader(header: string | null): Actor {
  if (
    header === null ||
    header.length === 0 ||
    header.length > MAX_HEADER_CHARS
  )
    throw new ArtifactsError(
      "BAD_REQUEST",
      "An X-Artifacts-Actor header is required",
    );
  let envelope: unknown;
  try {
    envelope = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    throw new ArtifactsError("BAD_REQUEST", "Invalid X-Artifacts-Actor header");
  }
  const parsed = ActorSchema.safeParse(envelope);
  if (!parsed.success)
    throw new ArtifactsError("BAD_REQUEST", "Invalid X-Artifacts-Actor header");
  if (parsed.data.kind === "human" || parsed.data.key.startsWith("human:"))
    throw new ArtifactsError(
      "BAD_REQUEST",
      "Only agents and runners use X-Artifacts-Actor",
    );
  return parsed.data;
}

/** The actor a browser request acts as, derived from the verified login. */
export function humanActor(login: string): Actor {
  return {
    key: `human:${login}`,
    kind: "human",
    name: login,
    metadata: {},
  };
}

/** Upserts the actor, bumping `lastSeenAt`, and returns who is calling. */
export async function upsertActor(db: Database, actor: Actor): Promise<Caller> {
  const workspaceKey = deriveWorkspaceKey(actor);
  const row = await db.actor.upsert({
    where: { key: actor.key },
    create: {
      key: actor.key,
      kind: actor.kind,
      name: actor.name,
      workspaceKey,
      metadata: actor.metadata,
    },
    update: {
      name: actor.name,
      metadata: actor.metadata,
      lastSeenAt: new Date(),
      seenCount: { increment: 1 },
      ...(workspaceKey === null ? {} : { workspaceKey }),
    },
  });
  return {
    id: row.id,
    key: row.key,
    kind: row.kind,
    name: row.name,
    workspaceKey: row.workspaceKey,
  };
}
