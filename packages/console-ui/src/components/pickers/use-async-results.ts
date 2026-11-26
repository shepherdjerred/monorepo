import { useRef, useState } from "react";

/** Loads results for what is typed; abort `signal` when a newer query wins. */
export type AsyncLoad<T> = (query: string, signal: AbortSignal) => Promise<T>;

export type AsyncResults<T> =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly query: string }
  | { readonly status: "done"; readonly query: string; readonly value: T }
  | {
      readonly status: "error";
      readonly query: string;
      readonly error: unknown;
    };

/**
 * Debounced, abortable loading driven from event handlers (no effect): each
 * `request` aborts the one before it, waits `delayMs`, then loads. Only the
 * newest query's result or error is kept, so a slow early answer never
 * replaces a later one.
 */
export function useAsyncResults<T>(
  load: AsyncLoad<T> | undefined,
  delayMs: number,
): {
  readonly results: AsyncResults<T>;
  /** Loads `query` with `using`, or with the hook's `load`. */
  readonly request: (query: string, using?: AsyncLoad<T>) => void;
  /** Aborts the pending load and forgets the results. */
  readonly cancel: () => void;
} {
  const [results, setResults] = useState<AsyncResults<T>>({ status: "idle" });
  const current = useRef<AbortController | null>(null);

  function abort(): void {
    current.current?.abort();
    current.current = null;
  }

  function cancel(): void {
    abort();
    setResults({ status: "idle" });
  }

  function request(
    query: string,
    using: AsyncLoad<T> | undefined = load,
  ): void {
    abort();
    if (using === undefined) {
      setResults({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    current.current = controller;
    const { signal } = controller;
    setResults({ status: "loading", query });
    const loader = using;
    async function settle(): Promise<void> {
      try {
        const value = await loader(query, signal);
        if (!signal.aborted) setResults({ status: "done", query, value });
      } catch (error: unknown) {
        if (!signal.aborted) setResults({ status: "error", query, error });
      }
    }
    const timer = setTimeout(() => {
      void settle();
    }, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
      },
      { once: true },
    );
  }

  return { results, request, cancel };
}
