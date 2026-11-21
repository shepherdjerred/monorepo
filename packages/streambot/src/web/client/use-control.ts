import { useEffect, useRef, useState } from "react";
import type { ApiFailure } from "./api.ts";
import { describeFailure, type FailureCopy } from "./messages.ts";

/** One outcome of a control's work: what to confirm, or why it failed. */
export type Outcome =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly failure: ApiFailure };

export type ControlState =
  | { readonly status: "idle" }
  | { readonly status: "pending" }
  | { readonly status: "done"; readonly message: string }
  | {
      readonly status: "failed";
      readonly failure: ApiFailure;
      readonly copy: FailureCopy;
    };

function stateFor(outcome: Outcome): ControlState {
  if (outcome.ok) return { status: "done", message: outcome.message };
  return outcome.failure.code === "aborted"
    ? { status: "idle" }
    : {
        status: "failed",
        failure: outcome.failure,
        copy: describeFailure(outcome.failure),
      };
}

/** How long a confirmation stays beside its control. Errors stay until the next attempt. */
const CONFIRMATION_MS = 8000;

/**
 * Local feedback for one control: its own pending flag, its own confirmation and its own error.
 * There is no global busy state, so one slow request never blocks another control. `retry`
 * reruns the last task, which reads the latest room when it runs.
 */
export function useControl() {
  const [state, setState] = useState<ControlState>({ status: "idle" });
  const last = useRef<((signal: AbortSignal) => Promise<Outcome>) | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (state.status !== "done") return;
    const timer = setTimeout(() => {
      setState({ status: "idle" });
    }, CONFIRMATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  const run = (task: (signal: AbortSignal) => Promise<Outcome>) => {
    last.current = task;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ status: "pending" });
    const settle = async () => {
      const outcome = await task(current.signal);
      if (current.signal.aborted) return;
      setState(stateFor(outcome));
    };
    void settle();
  };

  return {
    state,
    pending: state.status === "pending",
    run,
    retry: () => {
      if (last.current !== null) run(last.current);
    },
    /** Show a local explanation without sending anything (for example, no voice channel). */
    explain: (failure: ApiFailure) => {
      setState({ status: "failed", failure, copy: describeFailure(failure) });
    },
    dismiss: () => {
      setState({ status: "idle" });
    },
  };
}

export type Control = ReturnType<typeof useControl>;

/**
 * Several controls that report on one shared line: each keeps its own pending state, and the line
 * shows whichever was used last.
 */
export function useControlGroup<Key extends string>(
  controls: Readonly<Record<Key, Control>>,
) {
  const [last, setLast] = useState<Key | null>(null);
  return {
    controls,
    status: last === null ? null : controls[last],
    start: (key: Key, task: (signal: AbortSignal) => Promise<Outcome>) => {
      setLast(key);
      controls[key].run(task);
    },
  };
}
