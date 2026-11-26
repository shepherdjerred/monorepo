/**
 * The long-running incident commands. Both hold one change stream and
 * refetch on its frames; neither polls.
 */
import {
  isOpenStatus,
  type IncidentStreamFrame,
} from "@shepherdjerred/incidents/contract";
import { nothingOpenText, summaryLine } from "#lib/incidents/guidance.ts";
import { holdStream } from "#lib/incidents/stream.ts";
import { waitForIncident, type WaitResult } from "#lib/incidents/wait.ts";
import { result, type IncidentResult } from "./format.ts";
import type { IncidentCommandContext } from "./record.ts";
import {
  INCIDENT_EXIT,
  IncidentUsageError,
  systemsOf,
  timeoutMsOf,
  type IncidentOptions,
} from "./options.ts";

/** Exit 130 matches `ci wait`; the handler reports 143 for SIGTERM. */
export const CANCELED_EXIT = 130;

function waitText(outcome: WaitResult, timeoutMs = 0): string {
  switch (outcome.outcome) {
    case "nothing-open":
      return nothingOpenText(outcome.system ?? undefined);
    case "resolved":
      return `${outcome.incident.identifier} is ${outcome.incident.status}; continue your task.\n${summaryLine(outcome.incident)}`;
    case "suspect":
      return `You likely caused ${outcome.incident.identifier} — take it: toolkit incident take ${outcome.incident.identifier}`;
    case "commander":
      return outcome.via === "took"
        ? `You are now commander of ${outcome.incident.identifier}: nobody took it within the takeover grace. Fix it, post milestones with toolkit incident update ${outcome.incident.identifier}, and resolve with evidence.`
        : `You are commander of ${outcome.incident.identifier}; waiting on yourself would never end. Post milestones with toolkit incident update ${outcome.incident.identifier}.`;
    case "timeout":
      return `Timed out after ${String(timeoutMs / 1000)}s waiting on ${outcome.incident.identifier}; it is still ${outcome.incident.status} (${outcome.incident.command.state}). This does not mean it is stuck.`;
    case "canceled":
      return `Stopped waiting on ${outcome.incident.identifier}.`;
  }
}

const WAIT_EXIT: Readonly<Record<WaitResult["outcome"], number>> = {
  "nothing-open": INCIDENT_EXIT.ok,
  resolved: INCIDENT_EXIT.ok,
  suspect: INCIDENT_EXIT.suspect,
  commander: INCIDENT_EXIT.commander,
  timeout: INCIDENT_EXIT.timeout,
  canceled: CANCELED_EXIT,
};

export async function incidentWaitCommand(
  context: IncidentCommandContext,
  positionals: string[],
  options: IncidentOptions,
): Promise<IncidentResult> {
  const ref = positionals[0];
  const systems = systemsOf(options);
  if ((ref === undefined) === (systems.length === 0))
    throw new IncidentUsageError(
      "toolkit incident wait takes <INC-N> or one --system, not both",
    );
  if (systems.length > 1)
    throw new IncidentUsageError("wait takes one --system");
  if (options.spawn && options["no-spawn"])
    throw new IncidentUsageError("Choose --spawn or --no-spawn");
  const timeoutMs = timeoutMsOf(options);
  const outcome = await waitForIncident(
    { ...context, actor: await context.actor() },
    {
      ref,
      system: systems[0],
      spawn: !options["no-spawn"],
      timeoutMs,
      signal: context.signal,
    },
  );
  return result(
    WAIT_EXIT[outcome.outcome],
    outcome,
    waitText(outcome, timeoutMs),
  );
}

type WatchTarget = { readonly id: string; readonly identifier: string };
type WatchEnd = "done" | "timeout" | "stopped";

/** A FIFO of incidents to refetch, with one waiter for the next item. */
function refetchQueue() {
  /** `frame: null` is the snapshot read after each (re)connect. */
  const items: { incidentId: string; frame: IncidentStreamFrame | null }[] = [];
  let wake: (() => void) | undefined;
  return {
    push: (incidentId: string, frame: IncidentStreamFrame | null) => {
      items.push({ incidentId, frame });
      wake?.();
    },
    wake: () => wake?.(),
    next: async (signal: AbortSignal) => {
      while (items.length === 0 && !signal.aborted)
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      wake = undefined;
      return items.shift();
    },
  };
}

/** Print one line per change (refetched), until resolved, timeout, or a signal. */
async function streamChanges(
  context: IncidentCommandContext,
  target: WatchTarget | null,
  options: IncidentOptions,
  emit: (line: string) => void,
): Promise<WatchEnd> {
  const timeoutMs = timeoutMsOf(options);
  const { scheduler } = context;
  const controller = new AbortController();
  const queue = refetchQueue();
  let end: WatchEnd = "stopped";
  const stop = () => {
    controller.abort();
    queue.wake();
  };
  context.signal?.addEventListener("abort", stop, { once: true });
  const cancelTimeout =
    timeoutMs === undefined
      ? undefined
      : scheduler.at(scheduler.now() + timeoutMs, () => {
          end = "timeout";
          stop();
        });
  const streamTask = holdStream(
    context,
    target?.identifier ?? null,
    controller.signal,
    {
      onOpen: () => {
        if (target !== null) queue.push(target.id, null);
      },
      onFrame: (frame) => {
        queue.push(frame.incidentId, frame);
      },
    },
  );
  try {
    for (;;) {
      const item = await queue.next(controller.signal);
      if (item === undefined) return end;
      const incident = await context.api.byRef(item.incidentId);
      emit(
        options.json
          ? JSON.stringify({ frame: item.frame, incident })
          : `[${incident.updatedAt}] ${item.frame?.type ?? "current"}: ${summaryLine(incident)}`,
      );
      if (options["until-resolved"] && !isOpenStatus(incident.status))
        return "done";
    }
  } finally {
    context.signal?.removeEventListener("abort", stop);
    cancelTimeout?.();
    controller.abort();
    await streamTask;
  }
}

export async function incidentWatchCommand(
  context: IncidentCommandContext,
  positionals: string[],
  options: IncidentOptions,
  emit: (line: string) => void,
): Promise<IncidentResult> {
  const ref = positionals[0];
  const untilResolved = options["until-resolved"];
  if (untilResolved && ref === undefined)
    throw new IncidentUsageError("--until-resolved requires an incident");
  const target = ref === undefined ? null : await context.api.byRef(ref);
  if (untilResolved && target !== null && !isOpenStatus(target.status)) {
    emit(
      options.json ? JSON.stringify({ incident: target }) : summaryLine(target),
    );
    return result(INCIDENT_EXIT.ok, null, "");
  }
  const end = await streamChanges(context, target, options, emit);
  if (end === "timeout")
    return result(
      INCIDENT_EXIT.timeout,
      { outcome: "timeout" },
      `Timed out after ${String((timeoutMsOf(options) ?? 0) / 1000)}s watching incidents.`,
    );
  return end === "done" || !untilResolved
    ? result(INCIDENT_EXIT.ok, null, "")
    : result(CANCELED_EXIT, { outcome: "canceled" }, "Stopped watching.");
}
