/**
 * Command (single owner) rules. Every claim is decided here against one
 * record revision; the repository commits it with `UPDATE ... WHERE revision
 * = $read`, so of two concurrent claimers exactly one commits and the other
 * re-reads and sees the new owner.
 */
import {
  isOpenStatus,
  type ActorMetadata,
  type IncidentSuspect,
} from "#shared/contract.ts";
import { IncidentError } from "#domain/errors.ts";
import {
  begin,
  emit,
  incidentLabel,
  patch,
  requireActor,
  type ActorRef,
  type DomainContext,
  type IncidentRecord,
  type IncidentsSettings,
  type Transition,
} from "#domain/model.ts";

export function hashDispatchToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

/** `https://claude.ai/code/session_X` and `session_X` name the same session. */
function sessionName(value: string): string {
  const trimmed = value.trim().replace(/\/+$/u, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** The actor's session or branch matches the suspect: it likely caused this. */
export function isSuspect(
  suspect: IncidentSuspect | null,
  metadata: ActorMetadata | null,
): boolean {
  if (suspect === null || metadata === null) return false;
  if (suspect.sessionId !== undefined) {
    const wanted = sessionName(suspect.sessionId);
    const sessions = [metadata.sessionId, metadata.sessionLink].flatMap(
      (value) => (value === undefined ? [] : [sessionName(value)]),
    );
    if (sessions.includes(wanted)) return true;
  }
  return (
    suspect.branch !== undefined &&
    metadata.branch !== undefined &&
    suspect.branch === metadata.branch
  );
}

/**
 * Before `takeoverEligibleAt` only the suspect or the creator is expected to
 * take command of an incident. The grace protects whoever broke a shared
 * system; planned maintenance has no culprit, so anyone may own it at once.
 */
export function mayTakeNow(
  record: IncidentRecord,
  actor: ActorRef,
  now: Date,
): boolean {
  return (
    record.kind === "maintenance" ||
    now.getTime() >= record.takeoverEligibleAt.getTime() ||
    record.creatorId === actor.id ||
    isSuspect(record.suspect, actor.metadata)
  );
}

const CLEARED_LEASE = {
  dispatcherId: null,
  dispatchTokenHash: null,
  leaseExpiresAt: null,
} as const;

/** Lazily lapse an expired dispatch lease back to `none`. */
export function expireLease(
  transition: Transition,
  context: DomainContext,
): Transition {
  const record = transition.next;
  if (
    record.commandState !== "dispatching" ||
    record.leaseExpiresAt === null ||
    record.leaseExpiresAt.getTime() > context.now.getTime()
  )
    return transition;
  return emit(
    patch(transition, { commandState: "none", ...CLEARED_LEASE }),
    context,
    {
      type: "dispatch-expired",
      actorId: null,
      data: {
        dispatcherId: record.dispatcherId,
        leaseExpiresAt: record.leaseExpiresAt.toISOString(),
      },
    },
  );
}

function assertOpen(record: IncidentRecord): void {
  if (!isOpenStatus(record.status))
    throw new IncidentError(
      "BAD_REQUEST",
      `${incidentLabel(record)} is ${record.status}; reopen it first`,
    );
}

export type TakeRequest = {
  readonly dispatch: boolean;
  readonly force: boolean;
  readonly note: string | null;
  /** One-time token minted by the caller's context; only its hash is stored. */
  readonly dispatchToken: string;
};

export type TakeDecision =
  | { readonly outcome: "owned"; readonly transition: Transition }
  | {
      readonly outcome: "dispatching";
      readonly transition: Transition;
      readonly dispatchToken: string;
      readonly leaseExpiresAt: Date;
      readonly provider: string;
    }
  | {
      readonly outcome: "taken";
      readonly transition: Transition;
      readonly reason:
        "owned-by-other" | "dispatch-in-progress" | "not-eligible-yet";
    };

/** Why a `take` without `force` must yield, or null when it may proceed. */
function yieldReason(
  record: IncidentRecord,
  actor: ActorRef,
  now: Date,
): "owned-by-other" | "dispatch-in-progress" | "not-eligible-yet" | null {
  if (record.commandState === "owned") return "owned-by-other";
  if (record.commandState === "dispatching") return "dispatch-in-progress";
  return mayTakeNow(record, actor, now) ? null : "not-eligible-yet";
}

/**
 * Take command, or (`dispatch`) a short lease for an agent session the caller
 * is about to spawn. `force` bypasses the takeover grace and displaces a
 * current commander or dispatcher; it is recorded on the timeline.
 */
export function take(
  record: IncidentRecord,
  context: DomainContext,
  request: TakeRequest,
  settings: Pick<
    IncidentsSettings,
    "dispatchLeaseSeconds" | "takeoverSpawnEnabled" | "takeoverProvider"
  >,
): TakeDecision {
  assertOpen(record);
  const actor = requireActor(context);
  // Takeover and dispatch exist for broken shared systems. A maintenance
  // window is planned work with an owner; nobody spawns a commander for it.
  if (request.dispatch && record.kind === "maintenance")
    throw new IncidentError(
      "BAD_REQUEST",
      `${incidentLabel(record)} is maintenance; only incidents dispatch a commander session`,
    );
  if (request.dispatch && !settings.takeoverSpawnEnabled)
    throw new IncidentError(
      "PRECONDITION_FAILED",
      "Spawning a commander session is disabled (alert-dashboard-incidents-takeover-spawn-enabled)",
    );
  const settled = expireLease(begin(record), context);
  const current = settled.next;
  if (
    !request.dispatch &&
    current.commandState === "owned" &&
    current.commanderId === actor.id
  )
    return { outcome: "owned", transition: settled };
  const reason = yieldReason(current, actor, context.now);
  if (reason !== null && !request.force)
    return { outcome: "taken", transition: settled, reason };
  const data = {
    forced: reason !== null,
    ...(reason === null ? {} : { overrode: reason }),
    previousCommanderId: current.commanderId,
  };
  if (request.dispatch) {
    const leaseExpiresAt = new Date(
      context.now.getTime() + settings.dispatchLeaseSeconds * 1000,
    );
    const transition = emit(
      patch(settled, {
        commandState: "dispatching",
        commanderId: null,
        dispatcherId: actor.id,
        dispatchTokenHash: hashDispatchToken(request.dispatchToken),
        leaseExpiresAt,
      }),
      context,
      {
        type: "dispatched",
        body: request.note,
        data: {
          ...data,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
          provider: settings.takeoverProvider,
        },
      },
    );
    return {
      outcome: "dispatching",
      transition,
      dispatchToken: request.dispatchToken,
      leaseExpiresAt,
      provider: settings.takeoverProvider,
    };
  }
  const transition = emit(
    patch(settled, {
      commandState: "owned",
      commanderId: actor.id,
      everClaimed: true,
      ...CLEARED_LEASE,
    }),
    context,
    { type: "claimed", body: request.note, data },
  );
  return { outcome: "owned", transition };
}

/** The spawned session redeems the dispatcher's one-time token and becomes commander. */
export function claimDispatch(
  record: IncidentRecord,
  context: DomainContext,
  dispatchToken: string,
): Transition {
  assertOpen(record);
  const actor = requireActor(context);
  const settled = expireLease(begin(record), context);
  const current = settled.next;
  if (current.commandState === "owned" && current.commanderId === actor.id)
    return settled;
  if (current.commandState !== "dispatching")
    throw new IncidentError(
      "CONFLICT",
      `${incidentLabel(record)} has no active dispatch lease (it lapsed or was redeemed)`,
    );
  if (current.dispatchTokenHash !== hashDispatchToken(dispatchToken))
    throw new IncidentError("FORBIDDEN", "The dispatch token does not match");
  return emit(
    patch(settled, {
      commandState: "owned",
      commanderId: actor.id,
      everClaimed: true,
      ...CLEARED_LEASE,
    }),
    context,
    {
      type: "claimed",
      data: { viaDispatch: true, dispatcherId: current.dispatcherId },
    },
  );
}

/** The dispatcher gives its lease back (the spawn failed). A lapsed lease is a no-op. */
export function releaseDispatch(
  record: IncidentRecord,
  context: DomainContext,
  dispatchToken: string,
  reason: string,
): Transition {
  requireActor(context);
  const settled = expireLease(begin(record), context);
  const current = settled.next;
  if (current.commandState !== "dispatching") return settled;
  if (current.dispatchTokenHash !== hashDispatchToken(dispatchToken))
    throw new IncidentError("FORBIDDEN", "The dispatch token does not match");
  return emit(
    patch(settled, { commandState: "none", ...CLEARED_LEASE }),
    context,
    { type: "released", body: reason, data: { dispatch: true } },
  );
}

/** The commander hands command to another known actor, or releases it (`to === null`). */
export function handoff(
  record: IncidentRecord,
  context: DomainContext,
  to: ActorRef | null,
  note: string | null,
): Transition {
  assertOpen(record);
  const actor = requireActor(context);
  const settled = expireLease(begin(record), context);
  const current = settled.next;
  if (current.commandState !== "owned" || current.commanderId !== actor.id)
    throw new IncidentError(
      "FORBIDDEN",
      `Only the commander of ${incidentLabel(record)} can hand it off or release it`,
    );
  if (to === null)
    return emit(
      patch(settled, { commandState: "none", commanderId: null }),
      context,
      { type: "released", body: note },
    );
  if (to.id === actor.id) return settled;
  return emit(patch(settled, { commanderId: to.id }), context, {
    type: "handed-off",
    body: note,
    data: { fromActorId: actor.id, toActorId: to.id, toKey: to.key },
  });
}

export function isCommander(record: IncidentRecord, actor: ActorRef): boolean {
  return record.commandState === "owned" && record.commanderId === actor.id;
}
