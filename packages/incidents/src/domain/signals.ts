/**
 * Machine signals (Alertmanager alerts, the main-ci status) auto-open, attach
 * to, and clear incidents. Both producers go through `applySignal`, which is
 * idempotent: a producer may resend the same state every few minutes and only
 * a change in firing state reaches the timeline.
 */
import type { z } from "zod";
import {
  isOpenStatus,
  type IncidentSignalInputSchema,
  type IncidentSignalOutcome,
} from "#shared/contract.ts";
import { heldSystems } from "#domain/dedupe.ts";
import { declare, resolve } from "#domain/incident.ts";
import {
  begin,
  emit,
  isMoreSevere,
  patch,
  type DomainContext,
  type IncidentRecord,
  type IncidentsSettings,
  type LinkEntry,
  type SignalEntry,
  type Transition,
} from "#domain/model.ts";

export type IncidentSignal = z.output<typeof IncidentSignalInputSchema>;

export const AUTO_RESOLVE_NOTE =
  "Auto-resolved: every attached signal cleared before anyone took command.";

export type SignalDecision =
  | {
      readonly kind: "create";
      readonly outcome: "opened";
      readonly transition: Transition;
    }
  | {
      readonly kind: "update";
      readonly outcome: Exclude<IncidentSignalOutcome, "opened" | "ignored">;
      readonly previous: IncidentRecord;
      readonly transition: Transition;
    }
  | {
      readonly kind: "ignore";
      readonly outcome: "ignored";
      readonly reason: string;
    };

/**
 * Where a signal lands: the open record it is already attached to, else the
 * open incident holding its system, else (firing only) an active maintenance
 * window for the system, so planned work absorbs its own alerts.
 */
export function signalTarget(
  signal: IncidentSignal,
  open: readonly IncidentRecord[],
): IncidentRecord | null {
  const attached = open.find((record) =>
    record.signals.some((entry) => entry.key === signal.key),
  );
  if (attached !== undefined) return attached;
  const holder = open.find((record) =>
    heldSystems(record).includes(signal.system),
  );
  if (holder !== undefined) return holder;
  return signal.firing
    ? (open.find(
        (record) =>
          record.kind === "maintenance" &&
          (record.status === "in_progress" || record.status === "verifying") &&
          record.systems.includes(signal.system),
      ) ?? null)
    : null;
}

function autoOpenEnabled(
  signal: IncidentSignal,
  settings: IncidentsSettings,
): boolean {
  return signal.source === "alertmanager"
    ? settings.autoOpenAlertmanager
    : settings.autoOpenMainCi;
}

function signalEvent(signal: IncidentSignal) {
  return {
    type: signal.firing
      ? ("signal-firing" as const)
      : ("signal-cleared" as const),
    body: signal.title,
    actorId: null,
    data: {
      key: signal.key,
      source: signal.source,
      observedAt: new Date(signal.observedAt).toISOString(),
    },
  };
}

function mergeLinks(
  record: IncidentRecord,
  signal: IncidentSignal,
  context: DomainContext,
): LinkEntry[] {
  const links = [...record.links];
  for (const link of signal.links) {
    if (
      links.some((entry) => entry.kind === link.kind && entry.ref === link.ref)
    )
      continue;
    links.push({
      id: context.newId(),
      kind: link.kind,
      ref: link.ref,
      url: link.url ?? null,
      title: link.title ?? null,
      createdAt: context.now,
    });
  }
  return links;
}

function openFromSignal(
  signal: IncidentSignal,
  context: DomainContext,
  open: readonly IncidentRecord[],
  settings: IncidentsSettings,
): SignalDecision {
  const observedAt = new Date(signal.observedAt);
  const entry: SignalEntry = {
    key: signal.key,
    source: signal.source,
    title: signal.title,
    firing: true,
    firstFiredAt: observedAt,
    lastChangedAt: observedAt,
  };
  const declared = declare(
    {
      kind: "incident",
      title: signal.title,
      summary: signal.summary,
      severity: signal.severity,
      systems: [signal.system],
      components: [],
      exitCondition: signal.exitCondition,
      links: signal.links,
      takeCommand: false,
      ...(signal.suspect === undefined ? {} : { suspect: signal.suspect }),
    },
    context,
    {
      open,
      takeoverGraceSeconds: settings.takeoverGraceSeconds,
      source: signal.source,
      signals: [entry],
    },
  );
  return {
    kind: "create",
    outcome: "opened",
    transition: emit(declared, context, signalEvent(signal)),
  };
}

function fire(
  record: IncidentRecord,
  signal: IncidentSignal,
  context: DomainContext,
): SignalDecision {
  const existing = record.signals.find((entry) => entry.key === signal.key);
  const observedAt = new Date(signal.observedAt);
  const entry: SignalEntry = {
    key: signal.key,
    source: signal.source,
    title: signal.title,
    firing: true,
    firstFiredAt: existing?.firstFiredAt ?? observedAt,
    lastChangedAt: observedAt,
  };
  let transition = emit(
    patch(begin(record), {
      signals: [
        ...record.signals.filter((candidate) => candidate.key !== signal.key),
        entry,
      ],
      links: mergeLinks(record, signal, context),
      ...(record.suspect === null && signal.suspect !== undefined
        ? { suspect: signal.suspect }
        : {}),
    }),
    context,
    signalEvent(signal),
  );
  if (
    record.kind === "incident" &&
    isMoreSevere(signal.severity, record.severity)
  )
    transition = emit(
      patch(transition, { severity: signal.severity }),
      context,
      {
        type: "severity-changed",
        actorId: null,
        data: {
          from: record.severity,
          to: signal.severity,
          signal: signal.key,
        },
      },
    );
  return {
    kind: "update",
    outcome: existing === undefined ? "attached" : "updated",
    previous: record,
    transition,
  };
}

function clear(
  record: IncidentRecord,
  signal: IncidentSignal,
  context: DomainContext,
): SignalDecision {
  const observedAt = new Date(signal.observedAt);
  const signals = record.signals.map((entry) =>
    entry.key === signal.key
      ? { ...entry, firing: false, lastChangedAt: observedAt }
      : entry,
  );
  const cleared = emit(
    patch(begin(record), { signals }),
    context,
    signalEvent(signal),
  );
  const autoResolve =
    record.kind === "incident" &&
    record.source !== "manual" &&
    !record.everClaimed &&
    signals.every((entry) => !entry.firing);
  if (!autoResolve)
    return {
      kind: "update",
      outcome: "cleared",
      previous: record,
      transition: cleared,
    };
  const resolved = resolve(cleared.next, context, {
    note: AUTO_RESOLVE_NOTE,
    force: false,
    auto: true,
  });
  return {
    kind: "update",
    outcome: "auto-resolved",
    previous: record,
    transition: {
      next: resolved.next,
      events: [...cleared.events, ...resolved.events],
    },
  };
}

/** Decide what one signal does against the current open records. */
export function applySignal(
  signal: IncidentSignal,
  context: DomainContext,
  open: readonly IncidentRecord[],
  settings: IncidentsSettings,
): SignalDecision {
  const target = signalTarget(
    signal,
    open.filter((record) => isOpenStatus(record.status)),
  );
  if (target === null) {
    if (!signal.firing)
      return { kind: "ignore", outcome: "ignored", reason: "nothing attached" };
    if (!autoOpenEnabled(signal, settings))
      return {
        kind: "ignore",
        outcome: "ignored",
        reason: "auto-open disabled",
      };
    return openFromSignal(signal, context, open, settings);
  }
  const existing = target.signals.find((entry) => entry.key === signal.key);
  if (
    existing !== undefined &&
    new Date(signal.observedAt).getTime() < existing.lastChangedAt.getTime()
  )
    return { kind: "ignore", outcome: "ignored", reason: "out of order" };
  if (signal.firing) {
    return existing?.firing === true
      ? { kind: "ignore", outcome: "ignored", reason: "already firing" }
      : fire(target, signal, context);
  }
  return existing?.firing === true
    ? clear(target, signal, context)
    : { kind: "ignore", outcome: "ignored", reason: "already cleared" };
}
