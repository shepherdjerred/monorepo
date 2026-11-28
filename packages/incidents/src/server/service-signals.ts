/**
 * Signal ingestion for both machine producers. Each signal is ordered against
 * its durable observation watermark and decided against the current open set
 * (`ingestSignal`), then the watermark and any incident write commit together
 * under compare-and-set; a lost race re-reads and re-decides, so concurrent or
 * retried reports for one key leave exactly one winner and never regress the
 * watermark.
 */
import {
  incidentIdentifier,
  type IncidentSignalBatchResult,
  type IncidentSignalOutcome,
} from "#shared/contract.ts";
import type { AlertmanagerWebhook } from "#shared/alertmanager.ts";
import { alertmanagerSignals } from "#domain/alertmanager.ts";
import { ingestSignal, type IncidentSignal } from "#domain/signals.ts";
import type { IncidentRecord } from "#domain/model.ts";
import {
  RevisionConflictError,
  SystemsTakenError,
  type ActorRecord,
} from "#infrastructure/repository.ts";
import { actorRef, type ServiceCore } from "#server/service-core.ts";

function attachedIdentifier(
  open: readonly IncidentRecord[],
  key: string,
): string | null {
  const attached = open.find((record) =>
    record.signals.some((entry) => entry.key === key),
  );
  return attached === undefined ? null : incidentIdentifier(attached.number);
}

/** Each lost race means another report for the key committed; bound by realistic fan-in. */
const MAX_ATTEMPTS = 16;

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
      const [open, watermark] = await Promise.all([
        repository.openIncidents(),
        repository.findSignalWatermark(signal.source, signal.key),
      ]);
      const decision = ingestSignal(
        signal,
        core.domainContext(actorRef(actor)),
        { open, watermark },
        settings,
      );
      const ignored: SignalResult = {
        key: signal.key,
        outcome: "ignored",
        identifier: attachedIdentifier(open, signal.key),
      };
      if (decision.kind === "ignore") return ignored;
      try {
        const committed = await core.commitSignal({
          watermark: { previous: watermark, next: decision.observation },
          incident:
            decision.kind === "observe"
              ? null
              : {
                  previous:
                    decision.kind === "create" ? null : decision.previous,
                  transition: decision.transition,
                },
        });
        if (committed === null || decision.kind === "observe") return ignored;
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
