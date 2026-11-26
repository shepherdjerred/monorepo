import type {
  ActorInput,
  DeclareIncidentInput,
  IncidentDetail,
} from "@shepherdjerred/incidents/contract";
import { incidentsApi, type IncidentsApi } from "#lib/incidents/client.ts";
import type { Scheduler } from "#lib/incidents/scheduler.ts";
import type {
  RepoLocation,
  SpawnOutcome,
  SpawnRequest,
  Spawner,
} from "#lib/incidents/spawn.ts";
import { incidentStream } from "#lib/incidents/stream.ts";
import type { WaitDeps } from "#lib/incidents/wait.ts";
import {
  serveIncidentsHub,
  type IncidentsHub,
  type IncidentsTestSettings,
} from "#test/support/incidents-hub.ts";

export const T0 = Date.parse("2026-11-25T12:00:00.000Z");

export type FakeScheduler = Scheduler & {
  readonly advance: (ms: number) => void;
  readonly pending: () => number;
};

/** A clock the server and the waiters share; timers fire only on `advance`. */
export function fakeScheduler(start = T0): FakeScheduler {
  let now = start;
  let sequence = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => now,
    at: (at, callback) => {
      sequence += 1;
      const id = sequence;
      timers.set(id, { at, callback });
      return () => {
        timers.delete(id);
      };
    },
    advance: (ms) => {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= now)
        .sort(([, a], [, b]) => a.at - b.at);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.callback();
      }
    },
    pending: () => timers.size,
  };
}

export function agentActor(
  name: string,
  metadata: ActorInput["metadata"] = {},
): ActorInput {
  return {
    key: `claude-code:${name}`,
    kind: "agent",
    name: "claude-code",
    metadata: { branch: `${name}-branch`, ...metadata },
  };
}

export const DECLARER = agentActor("declarer");
export const REPO: RepoLocation = {
  repoMain: "/repo/monorepo",
  repoTop: "/repo/monorepo-worktree",
  root: "/home/agent/.herdr/worktrees/monorepo",
};

export type SpawnCall = {
  readonly waiter: string;
  readonly request: SpawnRequest;
  readonly token: string;
};

/** Records every spawn; `outcomes` answers calls in order (then succeeds). */
export function fakeSpawns(outcomes: SpawnOutcome[] = []) {
  const calls: SpawnCall[] = [];
  return {
    calls,
    spawnerFor:
      (waiter: string): Spawner =>
      (request, token) => {
        calls.push({ waiter, request, token });
        return Promise.resolve(outcomes.shift() ?? { ok: true });
      },
  };
}

export type TestHub = {
  readonly hub: IncidentsHub;
  readonly api: IncidentsApi;
  readonly scheduler: FakeScheduler;
  readonly logs: string[];
  readonly declare: (
    input: Partial<DeclareIncidentInput> & {
      systems: DeclareIncidentInput["systems"];
    },
  ) => Promise<IncidentDetail>;
  readonly deps: (actor: ActorInput, spawner: Spawner) => WaitDeps;
};

export async function startTestHub(
  settings: Partial<IncidentsTestSettings> = {},
): Promise<TestHub> {
  const scheduler = fakeScheduler();
  const hub = await serveIncidentsHub({
    clock: () => new Date(scheduler.now()),
    settings,
  });
  const api = incidentsApi(hub.url);
  const logs: string[] = [];
  return {
    hub,
    api,
    scheduler,
    logs,
    declare: (input) =>
      api.declare({
        actor: DECLARER,
        title: "Storage is read-only",
        severity: "sev2",
        exitCondition: "Writes to the storage pool succeed again.",
        ...input,
      }),
    deps: (actor, spawner) => ({
      api,
      actor,
      stream: incidentStream(hub.url),
      scheduler,
      spawner,
      spawnerName: "fake-spawner",
      repo: () => REPO,
      log: (line) => {
        logs.push(`${actor.key}: ${line}`);
      },
    }),
  };
}
