import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Sentry from "@sentry/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { matchPath, useLocation } from "react-router";
import {
  ExploreActiveRunSchema,
  type ExploreActiveRun,
  type ExploreTranscript,
} from "@scout-for-lol/data";
import {
  applyStreamEvent,
  createPendingTurn,
  markStopping,
} from "#src/lib/explore-turn-state.ts";
import { observeExploreRun } from "#src/lib/explore-stream.ts";
import {
  moveExploreClientRun,
  removeExploreClientRun,
  setExploreClientRun,
  type ExploreClientRun,
} from "#src/lib/explore-client-runs.ts";
import {
  exploreRunMarkerState,
  type ExploreRunOutcome,
} from "#src/lib/explore-run-completion.ts";
import {
  createExploreRunMarker,
  setExploreRunMarker,
} from "#src/lib/explore-run-markers.ts";
import { useExploreRunMarkers } from "#src/hooks/use-explore-run-markers.ts";
import { useTRPC } from "#src/lib/trpc.ts";
import {
  ExploreRunsContext,
  type ExploreRunsContextValue,
  type StartExploreTurnInput,
} from "#src/components/explore-runs-context.ts";

const NEW_CONVERSATION_KEY = "new";
const RECONNECT_DELAYS_MS = [250, 750, 1500, 3000];

type RunIdentity = Pick<
  ExploreActiveRun,
  "runId" | "conversationId" | "questionMessageId" | "leafIdAtStart"
>;

function conversationKey(conversationId: string | null): string {
  return conversationId ?? NEW_CONVERSATION_KEY;
}

function displayedExploreConversation(pathname: string): string | null {
  return (
    matchPath("/explore/:conversationId", pathname)?.params.conversationId ??
    null
  );
}

/**
 * Keeps Explore observers above the routed page that renders them.
 *
 * Route changes can hide a run, but only an explicit Stop mutation can cancel
 * it. On a full page reload this provider discovers the process-local server
 * runs again and receives a replaceable snapshot before live deltas resume.
 */
export function ExploreRunsProvider(props: { children: ReactNode }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const location = useLocation();
  const displayedConversationId = displayedExploreConversation(
    location.pathname,
  );
  const displayedConversationRef = useRef(displayedConversationId);
  displayedConversationRef.current = displayedConversationId;

  const { markers, updateMarkers } = useExploreRunMarkers(
    displayedConversationId,
  );
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const [activated, setActivated] = useState(
    () =>
      location.pathname.startsWith("/explore") ||
      markers.some((marker) => marker.state === "running"),
  );
  const [runs, setRuns] = useState<Map<string, ExploreClientRun>>(new Map());
  const runsRef = useRef(runs);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const controllersRef = useRef(new Map<string, AbortController>());
  const finishingRef = useRef(new Set<string>());
  const stopRequestedRef = useRef(new Set<string>());

  const startMutation = useMutation(trpc.explore.start.mutationOptions());
  const stopMutation = useMutation(trpc.explore.stop.mutationOptions());
  const activeRuns = useQuery({
    ...trpc.explore.activeRuns.queryOptions(),
    enabled: activated,
  });

  const updateRuns = useCallback(
    (
      update: (
        current: Map<string, ExploreClientRun>,
      ) => Map<string, ExploreClientRun>,
    ) => {
      const next = update(runsRef.current);
      runsRef.current = next;
      setRuns(next);
    },
    [],
  );

  const refreshConversation = useCallback(
    async (conversationId: string): Promise<ExploreTranscript | undefined> => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: trpc.explore.get.queryKey({ conversationId }),
        }),
        queryClient.invalidateQueries({
          queryKey: trpc.explore.list.queryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: trpc.explore.status.queryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: trpc.explore.activeRuns.queryKey(),
        }),
      ]);
      return await queryClient.fetchQuery({
        ...trpc.explore.get.queryOptions({ conversationId }),
        staleTime: 0,
      });
    },
    [
      queryClient,
      trpc.explore.activeRuns,
      trpc.explore.get,
      trpc.explore.list,
      trpc.explore.status,
    ],
  );

  const finishRun = useCallback(
    async (summary: RunIdentity, outcome: ExploreRunOutcome): Promise<void> => {
      if (finishingRef.current.has(summary.runId)) return;
      finishingRef.current.add(summary.runId);
      let transcript: ExploreTranscript | undefined;
      try {
        transcript = await refreshConversation(summary.conversationId);
      } catch (error) {
        Sentry.captureException(error);
      }

      const clientRun = runsRef.current.get(summary.conversationId);
      const finalMessageId = clientRun?.turn.finalMessageId ?? null;
      const effectiveState = exploreRunMarkerState({
        run: summary,
        outcome,
        finalMessageId,
        messages: transcript?.messages,
      });

      updateRuns((current) => {
        return removeExploreClientRun(current, summary.conversationId);
      });
      controllersRef.current.delete(summary.runId);
      finishingRef.current.delete(summary.runId);

      if (
        effectiveState === null ||
        displayedConversationRef.current === summary.conversationId
      ) {
        updateMarkers((current) =>
          current.filter(
            (marker) => marker.conversationId !== summary.conversationId,
          ),
        );
      } else {
        updateMarkers((current) =>
          setExploreRunMarker(
            current,
            createExploreRunMarker(summary, effectiveState),
          ),
        );
      }
    },
    [refreshConversation, updateMarkers, updateRuns],
  );

  const observe = useCallback(
    (summary: ExploreActiveRun): void => {
      if (controllersRef.current.has(summary.runId)) return;
      const controller = new AbortController();
      controllersRef.current.set(summary.runId, controller);

      void (async () => {
        let attempt = 0;
        while (!observerWasAborted(controller.signal)) {
          const terminal: { outcome: ExploreRunOutcome | null } = {
            outcome: null,
          };
          try {
            await observeExploreRun({
              runId: summary.runId,
              signal: controller.signal,
              onEvent: (event) => {
                const key = summary.conversationId;
                if (event.type === "error") {
                  setErrors((current) => {
                    const next = new Map(current);
                    next.set(key, event.message);
                    return next;
                  });
                } else if (event.type === "done") {
                  terminal.outcome = event.outcome;
                } else {
                  updateRuns((current) => {
                    const existing = current.get(key);
                    if (existing === undefined) return current;
                    return setExploreClientRun(current, key, {
                      ...existing,
                      turn: applyStreamEvent(existing.turn, event),
                    });
                  });
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
            RECONNECT_DELAYS_MS[
              Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)
            ] ?? 3000;
          attempt += 1;
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (observerWasAborted(controller.signal)) return;

          let discovered: ExploreActiveRun[];
          try {
            discovered = await queryClient.fetchQuery({
              ...trpc.explore.activeRuns.queryOptions(),
              staleTime: 0,
            });
          } catch {
            continue;
          }
          if (!discovered.some((run) => run.runId === summary.runId)) {
            await finishRun(summary, "interrupted");
            return;
          }
        }
      })();
    },
    [finishRun, queryClient, trpc.explore.activeRuns, updateRuns],
  );

  useEffect(() => {
    if (location.pathname.startsWith("/explore")) setActivated(true);
  }, [location.pathname]);

  useEffect(() => {
    if (markers.some((marker) => marker.state === "running")) {
      setActivated(true);
    }
  }, [markers]);

  useEffect(() => {
    if (!activeRuns.isSuccess) return;
    const discoveredIds = new Set(activeRuns.data.map((run) => run.runId));

    for (const rawSummary of activeRuns.data) {
      const summary = ExploreActiveRunSchema.parse(rawSummary);
      if (!runsRef.current.has(summary.conversationId)) {
        const seeded = applyStreamEvent(
          createPendingTurn({
            conversationId: summary.conversationId,
            question: null,
            leafIdAtStart: summary.leafIdAtStart,
          }),
          {
            type: "started",
            runId: summary.runId,
            conversationId: summary.conversationId,
            questionMessageId: summary.questionMessageId,
          },
        );
        updateRuns((current) => {
          return setExploreClientRun(current, summary.conversationId, {
            summary,
            turn: seeded,
          });
        });
      }
      updateMarkers((current) =>
        setExploreRunMarker(
          current,
          createExploreRunMarker(summary, "running"),
        ),
      );
      observe(summary);
    }

    for (const marker of markersRef.current) {
      if (marker.state === "running" && !discoveredIds.has(marker.runId)) {
        void finishRun(marker, "interrupted");
      }
    }
  }, [
    activeRuns.data,
    activeRuns.isSuccess,
    finishRun,
    observe,
    updateMarkers,
    updateRuns,
  ]);

  useEffect(
    () => () => {
      for (const controller of controllersRef.current.values()) {
        controller.abort();
      }
      controllersRef.current.clear();
    },
    [],
  );

  const startTurn = useCallback(
    async (input: StartExploreTurnInput): Promise<ExploreActiveRun | null> => {
      setActivated(true);
      const key = conversationKey(input.conversationId);
      if (runsRef.current.has(key)) return null;

      const initial = createPendingTurn({
        conversationId: input.conversationId,
        question: input.displayQuestion,
        leafIdAtStart: input.leafIdAtStart,
      });
      updateRuns((current) => {
        return setExploreClientRun(current, key, {
          summary: null,
          turn: initial,
        });
      });
      setErrors((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });

      try {
        const summary = ExploreActiveRunSchema.parse(
          await startMutation.mutateAsync({
            conversationId: input.conversationId,
            question: input.question,
            attach: input.attach,
          }),
        );
        const started = applyStreamEvent(initial, {
          type: "started",
          runId: summary.runId,
          conversationId: summary.conversationId,
          questionMessageId: summary.questionMessageId,
        });
        updateRuns((current) => {
          return moveExploreClientRun(current, key, summary.conversationId, {
            summary,
            turn: started,
          });
        });
        updateMarkers((current) =>
          setExploreRunMarker(
            current,
            createExploreRunMarker(summary, "running"),
          ),
        );
        observe(summary);

        if (stopRequestedRef.current.delete(key)) {
          void (async () => {
            try {
              await stopMutation.mutateAsync({ runId: summary.runId });
            } catch (error) {
              Sentry.captureException(error);
            }
          })();
        }
        return summary;
      } catch (error) {
        stopRequestedRef.current.delete(key);
        updateRuns((current) => {
          return removeExploreClientRun(current, key);
        });
        setErrors((current) => {
          const next = new Map(current);
          next.set(key, errorText(error));
          return next;
        });
        await queryClient.invalidateQueries({
          queryKey: trpc.explore.status.queryKey(),
        });
        return null;
      }
    },
    [
      observe,
      queryClient,
      startMutation,
      stopMutation,
      trpc.explore.status,
      updateMarkers,
      updateRuns,
    ],
  );

  const stop = useCallback(
    (conversationId: string | null): void => {
      const key = conversationKey(conversationId);
      const run = runsRef.current.get(key);
      if (run === undefined) return;
      updateRuns((current) => {
        const existing = current.get(key);
        if (existing === undefined) return current;
        return setExploreClientRun(current, key, {
          ...existing,
          turn: markStopping(existing.turn),
        });
      });
      if (run.summary === null) {
        stopRequestedRef.current.add(key);
        return;
      }
      const summary = run.summary;
      void (async () => {
        try {
          await stopMutation.mutateAsync({ runId: summary.runId });
        } catch (error) {
          Sentry.captureException(error);
        }
      })();
    },
    [stopMutation, updateRuns],
  );

  const value = useMemo<ExploreRunsContextValue>(
    () => ({
      discoverySettled: !activated || activeRuns.isSuccess,
      pendingTurn: (conversationId) =>
        runs.get(conversationKey(conversationId))?.turn ?? null,
      error: (conversationId) =>
        errors.get(conversationKey(conversationId)) ?? null,
      clearError: (conversationId) => {
        setErrors((current) => {
          const next = new Map(current);
          next.delete(conversationKey(conversationId));
          return next;
        });
      },
      startTurn,
      stop,
      status: (conversationId) => {
        if (runs.has(conversationId)) return "running";
        return (
          markers.find((marker) => marker.conversationId === conversationId)
            ?.state ?? null
        );
      },
    }),
    [activated, activeRuns.isSuccess, errors, markers, runs, startTurn, stop],
  );

  return (
    <ExploreRunsContext.Provider value={value}>
      {props.children}
    </ExploreRunsContext.Provider>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function observerWasAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
