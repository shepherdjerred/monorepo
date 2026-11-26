/**
 * Signal ingestion for both machine producers. Each signal is decided by the
 * domain's `applySignal` against the current open set and committed with the
 * same compare-and-set as commands; a lost race re-decides, so two producers
 * firing for one system at once still yield one incident.
 */
import {
  incidentIdentifier,
  type IncidentSignalBatchResult,
  type IncidentSignalOutcome,
} from "#shared/contract.ts";
import type { AlertmanagerWebhook } from "#shared/alertmanager.ts";
import { alertmanagerSignals } from "#domain/alertmanager.ts";
import { applySignal, type IncidentSignal } from "#domain/signals.ts";
import {
  RevisionConflictError,
  SystemsTakenError,
  type ActorRecord,
} from "#infrastructure/repository.ts";
import { actorRef, type ServiceCore } from "#server/service-core.ts";

const MAX_ATTEMPTS = 8;

const PRODUCERS = {
  alertmanager: { key: "system:alertmanager", name: "Alertmanager" },
  "main-ci": { key: "system:main-ci", name: "Main CI" },
} as const;

type SignalResult = IncidentSignalBatchResult["results"][number];

export function createSignalIngest(core: ServiceCore) {
  const { repository, options } = core;

  const producer = (source: IncidentSignal["source"]): Promise<ActorRecord> =>
    repository.upsertActor(
      {
        key: PRODUCERS[source].key,
        kind: "system",
        name: PRODUCERS[source].name,
      },
      options.clock(),
    );

  const one = async (signal: IncidentSignal): Promise<SignalResult> => {
    const settings = await core.settings();
    const actor = await producer(signal.source);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const open = await repository.openIncidents();
      const decision = applySignal(
        signal,
        core.domainContext(actorRef(actor)),
        open,
        settings,
      );
      if (decision.kind === "ignore") {
        const attached = open.find((record) =>
          record.signals.some((entry) => entry.key === signal.key),
        );
        return {
          key: signal.key,
          outcome: "ignored",
          identifier:
            attached === undefined ? null : incidentIdentifier(attached.number),
        };
      }
      try {
        const committed = await core.commitOrCreate(
          decision.kind === "create" ? null : decision.previous,
          decision.transition,
        );
        const outcome: IncidentSignalOutcome = decision.outcome;
        return {
          key: signal.key,
          outcome,
          identifier: incidentIdentifier(committed.number),
        };
      } catch (error: unknown) {
        if (
          error instanceof RevisionConflictError ||
          error instanceof SystemsTakenError
        )
          continue;
        throw error;
      }
    }
    throw new Error(
      `Signal ${signal.key} kept losing races; the producer will resend it`,
    );
  };

  /** Apply signals in order. With incidents disabled every signal is ignored. */
  const applySignals = async (
    signals: readonly IncidentSignal[],
  ): Promise<IncidentSignalBatchResult> => {
    const settings = await core.settings();
    const results: SignalResult[] = [];
    for (const signal of signals)
      results.push(
        settings.enabled
          ? await one(signal)
          : { key: signal.key, outcome: "ignored", identifier: null },
      );
    return { results };
  };

  const alertmanager = async (
    webhook: AlertmanagerWebhook,
  ): Promise<IncidentSignalBatchResult & { uncurated: number }> => {
    const translation = alertmanagerSignals(webhook);
    return {
      ...(await applySignals(translation.signals)),
      uncurated: translation.ignored,
    };
  };

  return { applySignals, alertmanager };
}
