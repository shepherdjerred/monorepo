/**
 * Turning a won dispatch lease into a commander session: spawn it, record
 * the spawn on the timeline (never the token), or give the lease back when
 * the spawn fails so another agent can retry.
 */
import { hostname } from "node:os";
import type {
  ActorInput,
  TakeCommandResult,
} from "@shepherdjerred/incidents/contract";
import { incidentRefusal, type IncidentsApi } from "./client.ts";
import {
  redactToken,
  spawnRequest,
  type RepoLocation,
  type Spawner,
} from "./spawn.ts";

export type DispatchDeps = {
  readonly api: Pick<IncidentsApi, "byRef" | "postUpdate" | "releaseDispatch">;
  readonly actor: ActorInput;
  readonly spawner: Spawner;
  /** Name recorded on the timeline when a session is spawned. */
  readonly spawnerName: string;
  readonly repo: () => RepoLocation;
  /** Progress for stderr. Never receives the dispatch token. */
  readonly log: (line: string) => void;
  readonly now: () => number;
};

export type DispatchLease = Extract<
  TakeCommandResult,
  { outcome: "dispatching" }
>;

export type DispatchAttempt = {
  readonly at: string;
  readonly outcome: "spawned" | "spawn-failed";
  readonly provider: string;
  readonly leaseExpiresAt: string;
  readonly error: string | null;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function recordSpawn(
  deps: DispatchDeps,
  id: string,
  lease: DispatchLease,
): Promise<void> {
  const body = `Spawned a commander session with ${deps.spawnerName} (provider ${lease.provider}) from ${hostname()}. It must claim command before ${lease.leaseExpiresAt}; otherwise the lease lapses and another waiter may dispatch.`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const current = await deps.api.byRef(id);
      await deps.api.postUpdate({
        actor: deps.actor,
        ref: id,
        expectedRevision: current.revision,
        body,
      });
      return;
    } catch (error) {
      if (incidentRefusal(error)?.conflict?.code !== "stale-revision") {
        deps.log(
          `Could not record the spawn on ${id}'s timeline: ${message(error)}`,
        );
        return;
      }
    }
  }
}

/** Spawn the commander for a lease this caller won. Never throws for a failed spawn. */
export async function dispatchCommander(
  deps: DispatchDeps,
  id: string,
  lease: DispatchLease,
): Promise<DispatchAttempt> {
  const token = lease.dispatchToken;
  let error: string | null = null;
  try {
    const detail = await deps.api.byRef(id);
    const request = spawnRequest(
      detail,
      { token, leaseExpiresAt: lease.leaseExpiresAt, provider: lease.provider },
      deps.repo(),
    );
    const outcome = await deps.spawner(request, token);
    if (!outcome.ok) error = outcome.error;
  } catch (error_) {
    error = message(error_);
  }
  const attempt: DispatchAttempt = {
    at: new Date(deps.now()).toISOString(),
    outcome: error === null ? "spawned" : "spawn-failed",
    provider: lease.provider,
    leaseExpiresAt: lease.leaseExpiresAt,
    error: error === null ? null : redactToken(error, token),
  };
  if (attempt.error === null) {
    deps.log(
      `Won the dispatch lease for ${id}; spawned a ${lease.provider} commander session. It must claim before ${lease.leaseExpiresAt}.`,
    );
    await recordSpawn(deps, id, lease);
    return attempt;
  }
  deps.log(
    `Spawning a commander for ${id} failed: ${attempt.error}. Releasing the lease so another agent can retry.`,
  );
  await deps.api.releaseDispatch({
    actor: deps.actor,
    ref: id,
    dispatchToken: token,
    reason: `Spawn failed: ${attempt.error}`.slice(0, 2000),
  });
  return attempt;
}
