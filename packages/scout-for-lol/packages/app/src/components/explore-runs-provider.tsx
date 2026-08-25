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
  type ExploreRunOutcome,
  type ExploreTranscript,
} from "@scout-for-lol/data";
import {
  applyStreamEvent,
  createPendingTurn,
  markStopping,
} from "#src/lib/explore-turn-state.ts";
import {
  clearExploreClientError,
  moveExploreClientRun,
  removeExploreClientRun,
  setExploreClientRun,
  shouldReconcileMissingExploreRun,
  type ExploreClientRun,
} from "#src/lib/explore-client-runs.ts";
import {
  resolveExploreRunCompletion,
  shouldClearExploreRunMarker,
  type ExploreRunIdentity,
} from "#src/lib/explore-run-completion.ts";
import {
  createExploreRunMarker,
  setExploreRunMarker,
} from "#src/lib/explore-run-markers.ts";
import { useExploreRunMarkers } from "#src/hooks/use-explore-run-markers.ts";
import { useMarkerDiscovery } from "#src/hooks/use-explore-marker-discovery.ts";
import { useExploreStartMutation } from "#src/hooks/use-explore-start-mutation.ts";
import { useExploreRunObserver } from "#src/hooks/use-explore-run-observer.ts";
import { analyticsCaptureEnabled, track } from "#src/lib/analytics.ts";
import { claimExploreRunFinished } from "#src/lib/explore-run-analytics.ts";
import { useTRPC } from "#src/lib/trpc.ts";
import { ExploreRunsContext } from "#src/components/explore-runs-context.ts";
import type {
  ExploreRunsContextValue,
  StartExploreTurnInput,
} from "#src/lib/explore-runs-contract.ts";

const NEW_CONVERSATION_KEY = "new";
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
  const { pathname } = useLocation();
  const displayedConversationId = displayedExploreConversation(pathname);
  const displayedConversationRef = useRef(displayedConversationId);
  displayedConversationRef.current = displayedConversationId;

  const { markers, updateMarkers, acknowledgeVisibleAnswer } =
    useExploreRunMarkers(displayedConversationId);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const [activated, setActivated] = useState(
    () =>
      pathname.startsWith("/explore") ||
      markers.some((marker) => marker.state === "running"),
  );
  const [runs, setRuns] = useState<Map<string, ExploreClientRun>>(new Map());
  const runsRef = useRef(runs);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const finishingRef = useRef(new Set<string>());
  const stopRequestedRef = useRef(new Set<string>());

  const startMutation = useExploreStartMutation();
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
      return await queryClient.query({
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
    async (
      summary: ExploreRunIdentity,
      outcome: ExploreRunOutcome,
    ): Promise<void> => {
      if (finishingRef.current.has(summary.runId)) return;
      finishingRef.current.add(summary.runId);
      if (
        analyticsCaptureEnabled() &&
        (await claimExploreRunFinished(summary.runId))
      ) {
        track("explore_turn_finished", { outcome });
      }
      let transcript: ExploreTranscript | undefined;
      try {
        transcript = await refreshConversation(summary.conversationId);
      } catch (error) {
        Sentry.captureException(error);
      }

      const clientRun = runsRef.current.get(summary.conversationId);
      const finalMessageId = clientRun?.turn.finalMessageId ?? null;
      const completion = resolveExploreRunCompletion({
        run: summary,
        outcome,
        finalMessageId,
        messages: transcript?.messages,
      });

      updateRuns((current) => {
        return removeExploreClientRun(current, summary.conversationId);
      });
      finishingRef.current.delete(summary.runId);

      if (
        shouldClearExploreRunMarker({
          ...completion,
          displayedConversationId: displayedConversationRef.current,
          runConversationId: summary.conversationId,
        })
      ) {
        updateMarkers((current) =>
          current.filter(
            (marker) => marker.conversationId !== summary.conversationId,
          ),
        );
      } else {
        const markerState = completion.markerState;
        if (markerState === null) {
          throw new Error("A cleared Explore run cannot retain a marker.");
        }
        updateMarkers((current) =>
          setExploreRunMarker(
            current,
            createExploreRunMarker(summary, markerState),
          ),
        );
      }
    },
    [refreshConversation, updateMarkers, updateRuns],
  );

  const { observe, observedRunIds, reconcileMissingRun } =
    useExploreRunObserver({ finishRun, setErrors, updateRuns });

  useEffect(() => {
    if (pathname.startsWith("/explore")) setActivated(true);
  }, [pathname]);

  useMarkerDiscovery(activated, markers, setActivated, activeRuns.refetch);

  useEffect(() => {
    if (!activeRuns.isSuccess) return;
    const discoveredIds = new Set(activeRuns.data.map((run) => run.runId));

    for (const rawSummary of activeRuns.data) {
      const summary = ExploreActiveRunSchema.parse(rawSummary);
      setErrors((current) =>
        clearExploreClientError(current, summary.conversationId),
      );
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

    const observedIds = observedRunIds();
    for (const marker of markersRef.current) {
      if (
        marker.state === "running" &&
        shouldReconcileMissingExploreRun({
          runId: marker.runId,
          discoveredRunIds: discoveredIds,
          observedRunIds: observedIds,
        })
      ) {
        void reconcileMissingRun(marker);
      }
    }
  }, [
    activeRuns.data,
    activeRuns.isSuccess,
    finishRun,
    observe,
    observedRunIds,
    reconcileMissingRun,
    updateMarkers,
    updateRuns,
  ]);

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
      setErrors((current) => clearExploreClientError(current, key));

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
        setErrors((current) =>
          clearExploreClientError(current, conversationKey(conversationId)),
        );
      },
      acknowledgeVisibleAnswer,
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
    [
      acknowledgeVisibleAnswer,
      activated,
      activeRuns.isSuccess,
      errors,
      markers,
      runs,
      startTurn,
      stop,
    ],
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
