import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardIndex, BoardOp } from "@shepherdjerred/artifacts/contract";
import { applyBoardOps } from "#domain/board-ops.ts";
import { api, keys, queryClient } from "#client/data/api.ts";
import { coalesceOps } from "./ops.ts";

/** A drag or resize that ends is saved this long after the last edit. */
export const SAVE_DEBOUNCE_MS = 400;
const RETRY_MS = 2000;

export type SaveStatus = "idle" | "saving" | "error";

export type BoardLayout = {
  /** The server's index with every edit not yet acknowledged applied on top. */
  readonly index: BoardIndex;
  /** The same, readable between renders (for the edit that is being made now). */
  readonly latest: () => BoardIndex;
  /** Applies ops locally at once and saves them, debounced. */
  readonly apply: (ops: readonly BoardOp[]) => void;
  /** Saves what is queued now. */
  readonly flush: () => void;
  readonly status: SaveStatus;
};

/**
 * The board's arrangement as a replicated document: the last index from the
 * server plus an outbox of ops. What is drawn is `base + outbox`, so a change
 * from another actor (an agent publishing a frame) merges by id with an edit
 * that is still being saved, and the ops are absolute and idempotent, so
 * replaying them over a fresher base is harmless.
 *
 * Saves go through `boards.applyOps`, which the server merges under a row
 * lock and never refuses. They are debounced after the last edit and flushed
 * when the page is hidden.
 */
export function useBoardLayout(slug: string, base: BoardIndex): BoardLayout {
  const queued = useRef<BoardOp[]>([]);
  const inflight = useRef<BoardOp[]>([]);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseRef = useRef(base);
  baseRef.current = base;

  const compute = useCallback(
    (from: BoardIndex): BoardIndex =>
      applyBoardOps(from, [...inflight.current, ...queued.current]),
    [],
  );
  // `revision` is the trigger: the outbox changed.
  const index = useMemo(() => compute(base), [base, compute, revision]);
  const indexRef = useRef(index);
  indexRef.current = index;
  const latest = useCallback(() => indexRef.current, []);

  const send = useCallback(async (): Promise<void> => {
    if (inflight.current.length > 0 || queued.current.length === 0) return;
    inflight.current = coalesceOps(queued.current);
    queued.current = [];
    setStatus("saving");
    try {
      const document = await api.boards.applyOps.mutate({
        slug,
        ops: inflight.current,
      });
      queryClient.setQueryData(keys.board(slug), (old: unknown) =>
        typeof old === "object" && old !== null
          ? { ...old, index: document.index }
          : old,
      );
      inflight.current = [];
      setRevision((value) => value + 1);
      if (queued.current.length > 0) {
        timer.current = setTimeout(() => {
          void send();
        }, SAVE_DEBOUNCE_MS);
      } else setStatus("idle");
    } catch {
      // Keep everything and try again; the ops replay safely.
      queued.current = coalesceOps([...inflight.current, ...queued.current]);
      inflight.current = [];
      setStatus("error");
      timer.current = setTimeout(() => {
        void send();
      }, RETRY_MS);
    }
  }, [slug]);

  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    void send();
  }, [send]);

  const apply = useCallback(
    (ops: readonly BoardOp[]) => {
      if (ops.length === 0) return;
      queued.current = coalesceOps([...queued.current, ...ops]);
      setRevision((value) => value + 1);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void send();
      }, SAVE_DEBOUNCE_MS);
    },
    [send],
  );

  // When the page goes away the request must survive it: `keepalive` lets the
  // browser finish it after the page is gone. Whatever is in flight is sent
  // again; ops are idempotent.
  useEffect(() => {
    async function beacon(): Promise<void> {
      const ops = coalesceOps([...inflight.current, ...queued.current]);
      if (ops.length === 0) return;
      try {
        await fetch(`${location.origin}/trpc/boards.applyOps`, {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, ops }),
        });
      } catch {
        // The page is going away; the ops stay queued if it comes back.
      }
    }
    function onHide(): void {
      void beacon();
    }
    globalThis.addEventListener("pagehide", onHide);
    return () => {
      globalThis.removeEventListener("pagehide", onHide);
      // Leaving the board inside the app saves too.
      void beacon();
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [slug]);

  return { index, latest, apply, flush, status };
}
