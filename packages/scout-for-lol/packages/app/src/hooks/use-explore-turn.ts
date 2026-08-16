import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ExploreAttachPoint,
  ExploreTranscript,
} from "@scout-for-lol/data";
import { streamExploreTurn } from "#src/lib/explore-stream.ts";
import {
  applyStreamEvent,
  createPendingTurn,
  markStopping,
  salvageRefreshDelays,
  turnHasLanded,
  type ExplorePendingTurn,
} from "#src/lib/explore-turn-state.ts";
import { useTRPC } from "#src/lib/trpc.ts";

/**
 * Read the ref through a function boundary: inside `runTurn`, control-flow
 * narrowing pins `turnRef.current` to the `null` the early-return guard saw,
 * but stream events reassign it between the guard and the catch/finally.
 */
function readTurn(ref: {
  current: ExplorePendingTurn | null;
}): ExplorePendingTurn | null {
  return ref.current;
}

/** Same narrowing-defeat as {@link readTurn}, for the run-sequence counter. */
function readSeq(ref: { current: number }): number {
  return ref.current;
}

/**
 * Re-reads of a conversation abandoned mid-turn, spaced to outlast the race
 * between the client's abort and the server's salvage write. Mirrors the
 * delays `salvageRefreshDelays` uses for a stop.
 */
const ABANDONED_TURN_REFRESH_DELAYS = [0, 600, 1500];

/**
 * Owns one in-flight explore turn: the streaming request, the pending-turn
 * state the transcript renders from, and the teardown that keeps the answer
 * on screen until the persisted transcript actually contains it.
 *
 * The decisions live in `explore-turn-state.ts` as pure functions; this hook
 * only drives the network and applies them.
 */
export function useExploreTurn(params: {
  conversationId: string | null;
  /** Fired on the stream's `started` event for a brand-new conversation. */
  onConversationStarted: (conversationId: string) => void;
  /** Refill the composer when a turn fails before its question persisted. */
  restoreQuestion: (text: string) => void;
}): {
  pendingTurn: ExplorePendingTurn | null;
  error: string | null;
  clearError: () => void;
  runTurn: (input: {
    question: string | null;
    attach: ExploreAttachPoint;
    displayQuestion: string | null;
    leafIdAtStart: string | null;
  }) => Promise<void>;
  stop: () => void;
  abortForNavigation: () => void;
} {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [pendingTurn, setPendingTurn] = useState<ExplorePendingTurn | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // A synchronous mirror of `pendingTurn`: stream events arrive faster than
  // React state settles, and the reducer must fold each event into the result
  // of the previous one, not into a stale render's snapshot.
  const turnRef = useRef<ExplorePendingTurn | null>(null);
  const seqRef = useRef(0);

  const applyTurn = useCallback((turn: ExplorePendingTurn | null): void => {
    turnRef.current = turn;
    setPendingTurn(turn);
  }, []);

  const refreshList = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: trpc.explore.list.queryKey(),
    });
  }, [queryClient, trpc.explore.list]);

  const refreshConversation = useCallback(
    async (conversationId: string): Promise<void> => {
      await queryClient.invalidateQueries({
        queryKey: trpc.explore.get.queryKey({ conversationId }),
      });
      await refreshList();
    },
    [queryClient, refreshList, trpc.explore.get],
  );

  const cachedMessages = useCallback(
    (conversationId: string) => {
      const transcript: ExploreTranscript | undefined =
        queryClient.getQueryData(trpc.explore.get.queryKey({ conversationId }));
      return transcript?.messages ?? [];
    },
    [queryClient, trpc.explore.get],
  );

  /**
   * A stop aborts the HTTP request, so the server's salvage write races the
   * refetch. `salvageRefreshDelays` decides how many reads this stop needs and
   * whether it needs any at all.
   */
  const awaitSalvage = useCallback(
    async (turn: ExplorePendingTurn): Promise<void> => {
      const plan = salvageRefreshDelays(turn);
      if (plan === null) {
        return;
      }
      const { conversationId, delays } = plan;
      applyTurn(markStopping(turn));
      for (const delay of delays) {
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        await refreshConversation(conversationId);
        if (turnHasLanded(turn, cachedMessages(conversationId))) {
          return;
        }
      }
    },
    [applyTurn, cachedMessages, refreshConversation],
  );

  const runTurn = useCallback(
    async (input: {
      question: string | null;
      attach: ExploreAttachPoint;
      displayQuestion: string | null;
      leafIdAtStart: string | null;
    }): Promise<void> => {
      if (turnRef.current !== null) {
        return;
      }
      // Identifies this run: after `abortForNavigation`, a newer turn may
      // already own the refs by the time this one's finally block fires, and
      // tearing down the newer turn's state would kill it mid-stream.
      const seq = seqRef.current + 1;
      seqRef.current = seq;
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      applyTurn(
        createPendingTurn({
          conversationId: params.conversationId,
          question: input.displayQuestion,
          leafIdAtStart: input.leafIdAtStart,
        }),
      );

      try {
        await streamExploreTurn({
          input: {
            conversationId: params.conversationId,
            question: input.question,
            attach: input.attach,
          },
          signal: controller.signal,
          onEvent: (event) => {
            // The same ownership question the finally block asks, and for the
            // same reason. `abortForNavigation` clears `turnRef` synchronously,
            // so a newer turn can be underway while this stream is still
            // draining: one `reader.read()` can carry several SSE blocks and
            // dispatches them with no abort checkpoint between them. Without
            // this, those leftovers edit the new turn's state and can announce
            // the abandoned run's conversation.
            if (readSeq(seqRef) !== seq) {
              return;
            }
            const current = turnRef.current;
            if (current === null) {
              return;
            }
            if (event.type === "error") {
              setError(event.message);
              return;
            }
            const next = applyStreamEvent(current, event);
            if (event.type === "started" && current.conversationId === null) {
              params.onConversationStarted(event.conversationId);
            }
            applyTurn(next);
          },
        });
      } catch (streamError) {
        if (!controller.signal.aborted) {
          setError(
            streamError instanceof Error
              ? streamError.message
              : String(streamError),
          );
          // The question never reached the server, so it exists nowhere but
          // here — hand it back. Once `started` arrived it is persisted, and
          // restoring it would duplicate it.
          const failed = readTurn(turnRef);
          if (failed?.questionMessageId === null && input.question !== null) {
            params.restoreQuestion(input.question);
          }
        }
      } finally {
        // Only tear down what this run still owns — see `seq` above.
        if (readSeq(seqRef) === seq) {
          abortRef.current = null;
          // Null here also means `abortForNavigation` abandoned the turn —
          // its conversation left the screen, so no salvage catch-up either.
          const turn = readTurn(turnRef);
          if (turn !== null) {
            if (controller.signal.aborted) {
              await awaitSalvage(turn);
            } else if (turn.conversationId !== null) {
              // Refetch before clearing, so there is no frame where the
              // answer is neither pending nor fetched.
              await refreshConversation(turn.conversationId);
            }
          }
          applyTurn(null);
        }
      }
    },
    [applyTurn, awaitSalvage, params, refreshConversation],
  );

  const stop = useCallback((): void => {
    abortRef.current?.abort();
  }, []);

  /**
   * Abandon the turn because its conversation is leaving the screen — a
   * sidebar switch, "new conversation", or deleting the streaming
   * conversation. Aborting (rather than letting it run in the background) is
   * deliberate: the backend allows one active run per user, so a backgrounded
   * run would silently block the next question. The server salvages what was
   * streamed; one delayed refresh makes it visible if the user returns.
   */
  const abortForNavigation = useCallback((): void => {
    const turn = turnRef.current;
    if (turn === null) {
      return;
    }
    abortRef.current?.abort();
    applyTurn(null);
    const conversationId = turn.conversationId;
    if (conversationId !== null) {
      // The same bounded poll a stop uses, for the same reason: the abort and
      // the server's salvage write race, and one fixed delay either fires
      // before the write lands or waits longer than it needed to. Leaving the
      // screen changes where the answer should be *rendered*, not whether it
      // should be *fetched* — a conversation the reader may well come back to
      // must not keep a question with nothing under it.
      void (async () => {
        for (const delay of ABANDONED_TURN_REFRESH_DELAYS) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          await refreshConversation(conversationId);
        }
      })();
    }
  }, [applyTurn, refreshConversation]);

  // Abandon an in-flight turn if the page unmounts.
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  return { pendingTurn, error, clearError, runTurn, stop, abortForNavigation };
}
