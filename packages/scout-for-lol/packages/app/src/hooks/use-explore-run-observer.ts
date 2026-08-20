import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import * as Sentry from "@sentry/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ExploreRunOutcomeResultSchema,
  type ExploreActiveRun,
  type ExploreRunOutcome,
} from "@scout-for-lol/data";
import { applyStreamEvent } from "#src/lib/explore-turn-state.ts";
import { observeExploreRun } from "#src/lib/explore-stream.ts";
import {
  setExploreClientRun,
  type ExploreClientRun,
} from "#src/lib/explore-client-runs.ts";
import type { ExploreRunIdentity } from "#src/lib/explore-run-completion.ts";
import { useTRPC } from "#src/lib/trpc.ts";

const RECONNECT_DELAYS_MS = [250, 750, 1500, 3000];

type UpdateRuns = (
  update: (
    current: Map<string, ExploreClientRun>,
  ) => Map<string, ExploreClientRun>,
) => void;

export function useExploreRunObserver(input: {
  finishRun: (
    summary: ExploreRunIdentity,
    outcome: ExploreRunOutcome,
  ) => Promise<void>;
  updateRuns: UpdateRuns;
  setErrors: Dispatch<SetStateAction<Map<string, string>>>;
}): {
  observe: (summary: ExploreActiveRun) => void;
  reconcileMissingRun: (summary: ExploreRunIdentity) => Promise<void>;
  observedRunIds: () => ReadonlySet<string>;
} {
  const { finishRun, updateRuns, setErrors } = input;
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const controllersRef = useRef(new Map<string, AbortController>());
  const reconcilingRef = useRef(new Set<string>());

  const fetchRunOutcome = useCallback(
    async (runId: string): Promise<ExploreRunOutcome | null> => {
      const result = ExploreRunOutcomeResultSchema.parse(
        await queryClient.fetchQuery({
          ...trpc.explore.runOutcome.queryOptions({ runId }),
          staleTime: 0,
        }),
      );
      return result.outcome;
    },
    [queryClient, trpc.explore.runOutcome],
  );

  const observe = useCallback(
    (summary: ExploreActiveRun): void => {
      if (controllersRef.current.has(summary.runId)) return;
      const controller = new AbortController();
      controllersRef.current.set(summary.runId, controller);

      void (async () => {
        try {
          await observeExploreRunUntilFinished({
            summary,
            controller,
            observeRun: observeExploreRun,
            fetchActiveRuns: async () =>
              await queryClient.fetchQuery({
                ...trpc.explore.activeRuns.queryOptions(),
                staleTime: 0,
              }),
            fetchRunOutcome,
            finishRun,
            updateRuns,
            setErrors,
          });
        } catch (error) {
          Sentry.captureException(error);
        } finally {
          controllersRef.current.delete(summary.runId);
        }
      })();
    },
    [
      fetchRunOutcome,
      finishRun,
      queryClient,
      setErrors,
      trpc.explore.activeRuns,
      updateRuns,
    ],
  );

  const reconcileMissingRun = useCallback(
    async (summary: ExploreRunIdentity): Promise<void> => {
      if (
        controllersRef.current.has(summary.runId) ||
        reconcilingRef.current.has(summary.runId)
      ) {
        return;
      }
      reconcilingRef.current.add(summary.runId);
      try {
        const confirmed = await queryClient.fetchQuery({
          ...trpc.explore.activeRuns.queryOptions(),
          staleTime: 0,
        });
        if (
          confirmed.some((run) => run.runId === summary.runId) ||
          controllersRef.current.has(summary.runId)
        ) {
          return;
        }
        const outcome = await fetchRunOutcome(summary.runId);
        if (controllersRef.current.has(summary.runId)) return;
        await finishRun(summary, outcome ?? "interrupted");
      } catch {
        // A temporary discovery failure leaves the running marker intact. The
        // next successful active-runs response will reconcile it again.
      } finally {
        reconcilingRef.current.delete(summary.runId);
      }
    },
    [fetchRunOutcome, finishRun, queryClient, trpc.explore.activeRuns],
  );

  const observedRunIds = useCallback(
    (): ReadonlySet<string> => new Set(controllersRef.current.keys()),
    [],
  );

  useEffect(
    () => () => {
      for (const controller of controllersRef.current.values()) {
        controller.abort();
      }
      controllersRef.current.clear();
    },
    [],
  );

  return { observe, reconcileMissingRun, observedRunIds };
}

export async function observeExploreRunUntilFinished(input: {
  summary: ExploreActiveRun;
  controller: AbortController;
  observeRun: typeof observeExploreRun;
  fetchActiveRuns: () => Promise<ExploreActiveRun[]>;
  fetchRunOutcome: (runId: string) => Promise<ExploreRunOutcome | null>;
  finishRun: (
    summary: ExploreRunIdentity,
    outcome: ExploreRunOutcome,
  ) => Promise<void>;
  updateRuns: UpdateRuns;
  setErrors: Dispatch<SetStateAction<Map<string, string>>>;
}): Promise<void> {
  const {
    summary,
    controller,
    observeRun,
    fetchActiveRuns,
    fetchRunOutcome,
    finishRun,
    updateRuns,
    setErrors,
  } = input;
  let attempt = 0;
  let missingConfirmations = 0;
  while (!observerWasAborted(controller.signal)) {
    const terminal: { outcome: ExploreRunOutcome | null } = { outcome: null };
    try {
      await observeRun({
        runId: summary.runId,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "error") {
            setErrors((current) =>
              setRunError(current, summary, event.message),
            );
          } else if (event.type === "done") {
            terminal.outcome = event.outcome;
          } else {
            updateRuns((current) => applyRunEvent(current, summary, event));
          }
        },
      });
      if (terminal.outcome !== null) {
        await finishRun(summary, terminal.outcome);
        return;
      }
    } catch {
      if (observerWasAborted(controller.signal)) return;
    }

    const delay =
      RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ??
      3000;
    attempt += 1;
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (observerWasAborted(controller.signal)) return;

    let discovered: ExploreActiveRun[];
    try {
      discovered = await fetchActiveRuns();
    } catch {
      continue;
    }
    if (discovered.some((run) => run.runId === summary.runId)) {
      missingConfirmations = 0;
      continue;
    }

    let outcome: ExploreRunOutcome | null;
    try {
      outcome = await fetchRunOutcome(summary.runId);
    } catch {
      continue;
    }
    if (outcome !== null) {
      await finishRun(summary, outcome);
      return;
    }
    missingConfirmations += 1;
    if (missingConfirmations >= 2) {
      await finishRun(summary, "interrupted");
      return;
    }
  }
}

function applyRunEvent(
  current: Map<string, ExploreClientRun>,
  summary: ExploreActiveRun,
  event: Parameters<typeof applyStreamEvent>[1],
): Map<string, ExploreClientRun> {
  const existing = current.get(summary.conversationId);
  if (existing === undefined) return current;
  return setExploreClientRun(current, summary.conversationId, {
    ...existing,
    turn: applyStreamEvent(existing.turn, event),
  });
}

function setRunError(
  current: Map<string, string>,
  summary: ExploreActiveRun,
  message: string,
): Map<string, string> {
  const next = new Map(current);
  next.set(summary.conversationId, message);
  return next;
}

function observerWasAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
