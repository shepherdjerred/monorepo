/**
 * `toolkit incident wait`: the blocked-agent protocol.
 *
 * Join as affected, hold one change stream, and refetch on every frame. Only
 * two instants matter without a frame (takeover eligibility and dispatch
 * lease expiry: the server lapses leases lazily, so nothing is published), so
 * one timer is armed for whichever is next. When the incident is unowned past
 * its takeover grace, try `take --dispatch`: the server's compare-and-set
 * lease guarantees exactly one waiter wins and spawns a commander session;
 * the rest see `dispatch-in-progress` and keep waiting. Maintenance is
 * waited on but never taken over.
 */
import { ZodError } from "zod";
import {
  IncidentSummarySchema,
  isOpenStatus,
  type IncidentSummary,
  type IncidentSystem,
  type TakeCommandResult,
} from "@shepherdjerred/incidents/contract";
import { incidentRefusal, type IncidentsApi } from "./client.ts";
import { isBlocking, shouldTake, type CheckedIncident } from "./guidance.ts";
import type { Scheduler } from "./scheduler.ts";
import {
  dispatchCommander,
  type DispatchAttempt,
  type DispatchDeps,
  type DispatchLease,
} from "./dispatch.ts";
import { holdStream, type IncidentStream } from "./stream.ts";

export type WaitDeps = Omit<DispatchDeps, "api" | "now"> & {
  readonly api: Pick<
    IncidentsApi,
    "check" | "byRef" | "join" | "take" | "releaseDispatch" | "postUpdate"
  >;
  readonly stream: IncidentStream;
  readonly scheduler: Scheduler;
};

export type WaitOptions = {
  readonly ref?: string | undefined;
  readonly system?: IncidentSystem | undefined;
  /** False (`--no-spawn`): take command directly instead of spawning a session. */
  readonly spawn: boolean;
  readonly timeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
};

type Ended =
  | { readonly outcome: "nothing-open"; readonly system: IncidentSystem | null }
  | { readonly outcome: "resolved"; readonly incident: IncidentSummary }
  | { readonly outcome: "suspect"; readonly incident: IncidentSummary }
  | {
      readonly outcome: "commander";
      readonly incident: IncidentSummary;
      readonly via: "already" | "took";
    }
  | { readonly outcome: "timeout"; readonly incident: IncidentSummary }
  | { readonly outcome: "canceled"; readonly incident: IncidentSummary };

export type WaitResult = Ended & {
  readonly dispatches: readonly DispatchAttempt[];
};

/** Server and local clocks can disagree; retry a not-yet-eligible take this much later. */
const SKEW_RETRY_MS = 5000;
const MAX_BACKOFF_MS = 30_000;
const JOIN_NOTE = "Blocked; waiting with toolkit incident wait.";
const TAKE_NOTE =
  "Nobody took command within the takeover grace; toolkit incident wait is taking over.";

type Wake = "start" | "open" | "frame" | "deadline" | "timeout" | "cancel";

/** Coalesces wake reasons: a burst of frames costs one refetch. */
function wakeQueue() {
  const pending = new Set<Wake>();
  let notify: (() => void) | undefined;
  return {
    push: (reason: Wake) => {
      pending.add(reason);
      notify?.();
    },
    next: async (): Promise<Set<Wake>> => {
      while (pending.size === 0)
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      notify = undefined;
      const reasons = new Set(pending);
      pending.clear();
      return reasons;
    },
  };
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function summaryOf(incident: IncidentSummary): IncidentSummary {
  return IncidentSummarySchema.parse(incident);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Transport failures are retried; refusals and contract drift are not. */
function isTransient(error: unknown): boolean {
  return !(error instanceof ZodError) && incidentRefusal(error) === null;
}

type Located =
  | { readonly kind: "open"; readonly entry: CheckedIncident }
  | { readonly kind: "terminal"; readonly incident: IncidentSummary }
  | { readonly kind: "none" };

async function locateRef(deps: WaitDeps, ref: string): Promise<Located> {
  const detail = await deps.api.byRef(ref);
  if (!isOpenStatus(detail.status))
    return { kind: "terminal", incident: summaryOf(detail) };
  const checked = await deps.api.check({ actor: deps.actor });
  const entry = checked.incidents.find(
    (item) => item.incident.id === detail.id,
  );
  if (entry !== undefined) return { kind: "open", entry };
  const latest = await deps.api.byRef(detail.id);
  return { kind: "terminal", incident: summaryOf(latest) };
}

async function locate(deps: WaitDeps, options: WaitOptions): Promise<Located> {
  if (options.ref !== undefined) return locateRef(deps, options.ref);
  const checked = await deps.api.check({
    actor: deps.actor,
    system: options.system,
  });
  const blocking = checked.incidents.filter((item) =>
    isBlocking(item.incident),
  );
  const entry =
    blocking.find((item) => item.incident.kind === "incident") ?? blocking[0];
  return entry === undefined ? { kind: "none" } : { kind: "open", entry };
}

/** Nothing open to wait on, or it already ended. */
function closed(
  located: Exclude<Located, { kind: "open" }>,
  options: WaitOptions,
): Ended {
  return located.kind === "none"
    ? { outcome: "nothing-open", system: options.system ?? null }
    : { outcome: "resolved", incident: located.incident };
}

/** You command it, or you caused it and nobody does: waiting would not help. */
function verdict(entry: CheckedIncident): Ended | null {
  if (entry.relation.commander)
    return { outcome: "commander", incident: entry.incident, via: "already" };
  return shouldTake(entry)
    ? { outcome: "suspect", incident: entry.incident }
    : null;
}

/** One wait's mutable state and its reactions to each observation. */
class Waiter {
  readonly dispatches: DispatchAttempt[] = [];
  latest: IncidentSummary;
  private failures = 0;
  private spawnFailed = false;
  private spawnDisabled = false;
  private notedSpawnFailure = false;
  private cancelDeadline: (() => void) | undefined;

  constructor(
    private readonly deps: WaitDeps,
    private readonly options: WaitOptions,
    private readonly first: IncidentSummary,
    private readonly wake: (reason: Wake) => void,
  ) {
    this.latest = first;
  }

  private get id(): string {
    return this.first.identifier;
  }

  armAt(at: number): void {
    this.disarm();
    this.cancelDeadline = this.deps.scheduler.at(at, () => {
      this.wake("deadline");
    });
  }

  /**
   * Arm for a deadline the server judges. When this clock already passed it
   * but the server has not (its clock is behind), retry after a short delay
   * instead of re-arming a past instant, which would spin.
   */
  private armServerDeadline(at: number): void {
    const now = this.deps.scheduler.now();
    this.armAt(at > now ? at : now + SKEW_RETRY_MS);
  }

  disarm(): void {
    this.cancelDeadline?.();
    this.cancelDeadline = undefined;
  }

  /** Refetch and react; a transport failure re-arms a backoff retry instead of ending the wait. */
  async step(): Promise<Ended | null> {
    try {
      const ended = await this.observe();
      this.failures = 0;
      return ended;
    } catch (error) {
      if (!isTransient(error)) throw error;
      this.failures += 1;
      const delay = Math.min(1000 * 2 ** this.failures, MAX_BACKOFF_MS);
      this.deps.log(
        `Reading ${this.id} failed (${message(error)}); retrying in ${String(delay / 1000)}s.`,
      );
      this.armAt(this.deps.scheduler.now() + delay);
      return null;
    }
  }

  private async observe(): Promise<Ended | null> {
    const checked = await this.deps.api.check({ actor: this.deps.actor });
    const entry = checked.incidents.find(
      (item) => item.incident.id === this.first.id,
    );
    if (entry !== undefined) return this.evaluate(entry);
    const detail = await this.deps.api.byRef(this.first.id);
    return isOpenStatus(detail.status)
      ? null
      : { outcome: "resolved", incident: summaryOf(detail) };
  }

  private async evaluate(entry: CheckedIncident): Promise<Ended | null> {
    this.latest = entry.incident;
    const ended = verdict(entry);
    if (ended !== null) return ended;
    const { command } = entry.incident;
    // Maintenance has an owner by plan, not by takeover: wait for it to end.
    if (entry.incident.kind === "maintenance" || command.state === "owned") {
      this.disarm();
      return null;
    }
    if (command.state === "dispatching") {
      if (command.leaseExpiresAt !== null)
        this.armServerDeadline(Date.parse(command.leaseExpiresAt));
      return null;
    }
    const eligibleAt = Date.parse(command.takeoverEligibleAt);
    if (this.deps.scheduler.now() < eligibleAt) {
      this.armAt(eligibleAt);
      return null;
    }
    this.disarm();
    return this.spawnFailed ? this.leaveToOthers() : this.takeOver();
  }

  private leaveToOthers(): null {
    if (!this.notedSpawnFailure)
      this.deps.log(
        `${this.id} is unowned; this waiter's spawn failed, so it leaves the next dispatch to another waiter.`,
      );
    this.notedSpawnFailure = true;
    return null;
  }

  private async takeOver(): Promise<Ended | null> {
    if (!this.options.spawn || this.spawnDisabled) return this.takeDirectly();
    let result: TakeCommandResult;
    try {
      result = await this.deps.api.take({
        actor: this.deps.actor,
        ref: this.id,
        dispatch: true,
        note: TAKE_NOTE,
      });
    } catch (error) {
      if (incidentRefusal(error)?.code !== "PRECONDITION_FAILED") throw error;
      this.spawnDisabled = true;
      this.deps.log(
        `Spawning commander sessions is disabled; taking command of ${this.id} directly.`,
      );
      return this.takeDirectly();
    }
    if (result.outcome === "owned")
      return { outcome: "commander", incident: result.incident, via: "took" };
    if (result.outcome === "taken") this.yielded(result);
    else await this.dispatch(result);
    return null;
  }

  private async takeDirectly(): Promise<Ended | null> {
    const result = await this.deps.api.take({
      actor: this.deps.actor,
      ref: this.id,
      note: TAKE_NOTE,
    });
    if (result.outcome === "owned")
      return { outcome: "commander", incident: result.incident, via: "took" };
    if (result.outcome === "taken") this.yielded(result);
    return null;
  }

  private async dispatch(lease: DispatchLease): Promise<void> {
    const attempt = await dispatchCommander(
      { ...this.deps, now: this.deps.scheduler.now },
      this.id,
      lease,
    );
    this.dispatches.push(attempt);
    if (attempt.outcome === "spawn-failed") this.spawnFailed = true;
  }

  /** A take that did not win: arm for whatever ends the other holder's turn. */
  private yielded(
    result: Extract<TakeCommandResult, { outcome: "taken" }>,
  ): void {
    this.latest = result.incident;
    if (result.reason === "not-eligible-yet") {
      this.armAt(this.deps.scheduler.now() + SKEW_RETRY_MS);
      return;
    }
    const lease = result.incident.command.leaseExpiresAt;
    if (lease !== null && result.reason === "dispatch-in-progress") {
      this.deps.log(
        `Another waiter is dispatching a commander for ${this.id}; still waiting.`,
      );
      this.armServerDeadline(Date.parse(lease));
      return;
    }
    this.disarm();
  }
}

export async function waitForIncident(
  deps: WaitDeps,
  options: WaitOptions,
): Promise<WaitResult> {
  const located = await locate(deps, options);
  if (located.kind !== "open")
    return { ...closed(located, options), dispatches: [] };
  const first = located.entry;
  const early = verdict(first);
  if (early !== null) return { ...early, dispatches: [] };
  const id = first.incident.identifier;
  // A signal that fired during these reads is not replayed to listeners added later.
  const canceled = (): WaitResult => ({
    outcome: "canceled",
    incident: first.incident,
    dispatches: [],
  });
  if (isAborted(options.signal)) return canceled();
  if (!first.relation.affected)
    await deps.api.join({ actor: deps.actor, ref: id, note: JOIN_NOTE });
  if (isAborted(options.signal)) return canceled();

  const { scheduler } = deps;
  const wakeups = wakeQueue();
  const waiter = new Waiter(deps, options, first.incident, wakeups.push);
  const done = (ended: Ended): WaitResult => ({
    ...ended,
    dispatches: waiter.dispatches,
  });
  const controller = new AbortController();
  const onCancel = () => {
    wakeups.push("cancel");
  };
  options.signal?.addEventListener("abort", onCancel, { once: true });
  if (isAborted(options.signal)) onCancel();
  const cancelTimeout =
    options.timeoutMs === undefined
      ? undefined
      : scheduler.at(scheduler.now() + options.timeoutMs, () => {
          wakeups.push("timeout");
        });
  deps.log(
    `Waiting on ${id} (${first.incident.title}). Joined as affected; exits 0 when it resolves.`,
  );
  const streamTask = holdStream(deps, id, controller.signal, {
    onOpen: () => {
      wakeups.push("open");
    },
    onFrame: () => {
      wakeups.push("frame");
    },
  });
  wakeups.push("start");
  try {
    for (;;) {
      const reasons = await wakeups.next();
      if (reasons.has("cancel"))
        return done({ outcome: "canceled", incident: waiter.latest });
      if (reasons.has("timeout"))
        return done({ outcome: "timeout", incident: waiter.latest });
      const ended = await waiter.step();
      if (ended !== null) return done(ended);
    }
  } finally {
    options.signal?.removeEventListener("abort", onCancel);
    controller.abort();
    waiter.disarm();
    cancelTimeout?.();
    await streamTask;
  }
}
