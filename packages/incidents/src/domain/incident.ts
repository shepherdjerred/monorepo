/**
 * Declaring and editing incidents, and moving them through their lifecycle.
 * Each function returns a Transition; an empty event list means "nothing
 * changed" and the caller commits nothing.
 */
import type { z } from "zod";
import {
  isOpenStatus,
  type DeclareIncidentInputSchema,
  type EditIncidentInputSchema,
  type IncidentLinkInput,
  type IncidentSource,
  type IncidentStatus,
} from "#shared/contract.ts";
import { assertNoOverlap } from "#domain/dedupe.ts";
import { IncidentError } from "#domain/errors.ts";
import {
  begin,
  emit,
  incidentLabel,
  patch,
  requireActor,
  type DomainContext,
  type IncidentRecord,
  type LinkEntry,
  type SignalEntry,
  type Transition,
} from "#domain/model.ts";
import {
  canMove,
  initialStatus,
  marksMitigation,
  reopenTarget,
  resolveTarget,
} from "#domain/lifecycle.ts";
import { isCommander } from "#domain/command.ts";

export type DeclareFields = Omit<
  z.output<typeof DeclareIncidentInputSchema>,
  "actor"
>;

function linkEntries(
  links: readonly IncidentLinkInput[],
  context: DomainContext,
  existing: readonly LinkEntry[] = [],
): LinkEntry[] {
  const out = [...existing];
  for (const link of links) {
    if (out.some((entry) => entry.kind === link.kind && entry.ref === link.ref))
      continue;
    out.push({
      id: context.newId(),
      kind: link.kind,
      ref: link.ref,
      url: link.url ?? null,
      title: link.title ?? null,
      createdAt: context.now,
    });
  }
  return out;
}

function parseInstant(value: string | undefined): Date | null {
  return value === undefined ? null : new Date(value);
}

function validateSchedule(fields: DeclareFields): void {
  const start = parseInstant(fields.scheduledStart);
  const end = parseInstant(fields.scheduledEnd);
  if (fields.kind === "incident" && (start !== null || end !== null))
    throw new IncidentError(
      "BAD_REQUEST",
      "Only maintenance has a scheduled window",
    );
  if (start !== null && end !== null && end.getTime() <= start.getTime())
    throw new IncidentError(
      "BAD_REQUEST",
      "scheduledEnd must be after scheduledStart",
    );
}

/** A new record (number 0 until the repository assigns `INC-N`) with its `declared` event. */
export function declare(
  fields: DeclareFields,
  context: DomainContext,
  options: {
    readonly open: readonly IncidentRecord[];
    readonly takeoverGraceSeconds: number;
    readonly source?: IncidentSource;
    readonly signals?: readonly SignalEntry[];
  },
): Transition {
  validateSchedule(fields);
  const status = initialStatus(fields.kind);
  const systems = [...new Set(fields.systems)];
  assertNoOverlap({ kind: fields.kind, status, systems }, options.open);
  const actorId = context.actor?.id ?? null;
  const record: IncidentRecord = {
    id: context.newId(),
    number: 0,
    kind: fields.kind,
    title: fields.title,
    summary: fields.summary,
    impact: fields.impact ?? null,
    severity: fields.severity,
    status,
    systems,
    components: [...new Set(fields.components)],
    exitCondition: fields.exitCondition,
    source: options.source ?? "manual",
    suspect: fields.suspect ?? null,
    creatorId: actorId,
    commandState: "none",
    commanderId: null,
    dispatcherId: null,
    dispatchTokenHash: null,
    leaseExpiresAt: null,
    everClaimed: false,
    takeoverEligibleAt: new Date(
      context.now.getTime() + options.takeoverGraceSeconds * 1000,
    ),
    declaredAt: context.now,
    updatedAt: context.now,
    mitigatedAt: null,
    resolvedAt: null,
    resolutionNote: null,
    scheduledStart: parseInstant(fields.scheduledStart),
    scheduledEnd: parseInstant(fields.scheduledEnd),
    revision: 0,
    lastEventSeq: 0,
    affected: [],
    links: linkEntries(fields.links, context),
    signals: options.signals ?? [],
  };
  const declared = emit(begin(record), context, {
    type: "declared",
    body: fields.summary === "" ? null : fields.summary,
    data: { kind: fields.kind, severity: fields.severity, systems },
  });
  if (actorId === null || !fields.takeCommand) return declared;
  return emit(
    patch(declared, {
      commandState: "owned",
      commanderId: actorId,
      everClaimed: true,
    }),
    context,
    { type: "claimed", data: { atDeclaration: true } },
  );
}

export function postUpdate(
  record: IncidentRecord,
  context: DomainContext,
  body: string,
): Transition {
  requireActor(context);
  return emit(begin(record), context, { type: "update", body });
}

export function changeStatus(
  record: IncidentRecord,
  context: DomainContext,
  status: IncidentStatus,
  note: string | null,
): Transition {
  requireActor(context);
  if (status === record.status) return begin(record);
  if (!canMove(record.kind, record.status, status))
    throw new IncidentError(
      "BAD_REQUEST",
      `${incidentLabel(record)} (${record.kind}) cannot move from ${record.status} to ${status}` +
        (isOpenStatus(status) ? "" : "; use resolve"),
    );
  if (status === "canceled" && note === null)
    throw new IncidentError(
      "BAD_REQUEST",
      "Canceling maintenance needs a note",
    );
  const fields: Partial<IncidentRecord> =
    status === "canceled"
      ? {
          status,
          resolvedAt: context.now,
          resolutionNote: note,
          commandState:
            record.commandState === "dispatching"
              ? "none"
              : record.commandState,
          dispatcherId: null,
          dispatchTokenHash: null,
          leaseExpiresAt: null,
        }
      : {
          status,
          ...(marksMitigation(status) && record.mitigatedAt === null
            ? { mitigatedAt: context.now }
            : {}),
        };
  return emit(patch(begin(record), fields), context, {
    type: "status-changed",
    body: note,
    data: { from: record.status, to: status },
  });
}

export type EditFields = Omit<
  z.output<typeof EditIncidentInputSchema>,
  "actor" | "ref" | "expectedRevision"
>;

const EDITABLE = [
  "title",
  "summary",
  "impact",
  "systems",
  "components",
  "exitCondition",
  "suspect",
] as const;

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function keep<T>(value: T | undefined, current: T): T {
  return value === undefined ? current : value;
}

function uniqueOr<T>(
  values: readonly T[] | undefined,
  current: readonly T[],
): readonly T[] {
  return values === undefined ? current : [...new Set(values)];
}

function applyEdits(
  record: IncidentRecord,
  fields: EditFields,
): IncidentRecord {
  return {
    ...record,
    title: keep(fields.title, record.title),
    summary: keep(fields.summary, record.summary),
    impact: keep(fields.impact, record.impact),
    systems: uniqueOr(fields.systems, record.systems),
    components: uniqueOr(fields.components, record.components),
    exitCondition: keep(fields.exitCondition, record.exitCondition),
    suspect: keep(fields.suspect, record.suspect),
  };
}

export function edit(
  record: IncidentRecord,
  context: DomainContext,
  fields: EditFields,
  open: readonly IncidentRecord[],
): Transition {
  requireActor(context);
  const next = applyEdits(record, fields);
  const changed = EDITABLE.filter((key) => !sameValue(next[key], record[key]));
  let transition = begin(record);
  if (changed.length > 0) {
    assertNoOverlap(next, open, record.id);
    transition = emit({ next, events: [] }, context, {
      type: "edited",
      data: { fields: changed },
    });
  }
  const severity = keep(fields.severity, record.severity);
  if (severity === record.severity) return transition;
  return emit(patch(transition, { severity }), context, {
    type: "severity-changed",
    data: { from: record.severity, to: severity },
  });
}

export function addLink(
  record: IncidentRecord,
  context: DomainContext,
  link: IncidentLinkInput,
): Transition {
  requireActor(context);
  const links = linkEntries([link], context, record.links);
  if (links.length === record.links.length) return begin(record);
  return emit(patch(begin(record), { links }), context, {
    type: "link-added",
    data: { kind: link.kind, ref: link.ref, url: link.url ?? null },
  });
}

export function join(
  record: IncidentRecord,
  context: DomainContext,
  note: string | null,
): Transition {
  const actor = requireActor(context);
  if (record.affected.some((entry) => entry.actorId === actor.id))
    return begin(record);
  return emit(
    patch(begin(record), {
      affected: [
        ...record.affected,
        { actorId: actor.id, joinedAt: context.now },
      ],
    }),
    context,
    { type: "joined", body: note },
  );
}

export function leave(
  record: IncidentRecord,
  context: DomainContext,
  note: string | null,
): Transition {
  const actor = requireActor(context);
  const affected = record.affected.filter(
    (entry) => entry.actorId !== actor.id,
  );
  if (affected.length === record.affected.length) return begin(record);
  return emit(patch(begin(record), { affected }), context, {
    type: "left",
    body: note,
  });
}

/**
 * Resolve (or complete maintenance) with a resolution note. Only the
 * commander may resolve unless `force` is set; `auto` is the signal path.
 */
export function resolve(
  record: IncidentRecord,
  context: DomainContext,
  request: {
    readonly note: string;
    readonly force: boolean;
    readonly auto?: boolean;
  },
): Transition {
  const target = resolveTarget(record.kind, record.status);
  if (target === null)
    throw new IncidentError(
      "BAD_REQUEST",
      isOpenStatus(record.status)
        ? `Maintenance ${incidentLabel(record)} has not started; cancel it instead`
        : `${incidentLabel(record)} is already ${record.status}`,
    );
  const auto = request.auto === true;
  if (!auto) {
    const actor = requireActor(context);
    if (!isCommander(record, actor) && !request.force)
      throw new IncidentError(
        "FORBIDDEN",
        `Only the commander of ${incidentLabel(record)} can resolve it; pass force to override`,
      );
  }
  const forced =
    !auto && context.actor !== null && !isCommander(record, context.actor);
  return emit(
    patch(begin(record), {
      status: target,
      resolvedAt: context.now,
      resolutionNote: request.note,
      commandState:
        record.commandState === "dispatching" ? "none" : record.commandState,
      dispatcherId: null,
      dispatchTokenHash: null,
      leaseExpiresAt: null,
    }),
    context,
    { type: "resolved", body: request.note, data: { forced, auto } },
  );
}

export function reopen(
  record: IncidentRecord,
  context: DomainContext,
  note: string,
  open: readonly IncidentRecord[],
): Transition {
  requireActor(context);
  const target = reopenTarget(record.status);
  if (target === null)
    throw new IncidentError(
      "BAD_REQUEST",
      `${incidentLabel(record)} is ${record.status} and cannot be reopened`,
    );
  assertNoOverlap({ ...record, status: target }, open, record.id);
  return emit(
    patch(begin(record), {
      status: target,
      resolvedAt: null,
      resolutionNote: null,
    }),
    context,
    { type: "reopened", body: note, data: { from: record.status, to: target } },
  );
}
