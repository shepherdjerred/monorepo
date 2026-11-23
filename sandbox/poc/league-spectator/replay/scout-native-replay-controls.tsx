import { useEffect, useRef } from "react";
import type { ReplaySession, ReplaySessionState } from "@scout-for-lol/replay";
import { loadVerifiedReplaySource } from "../../../../packages/scout-for-lol/packages/app/src/lib/replay/load-session.ts";

type ControlOwner = {
  update: (state: ReplaySessionState) => void;
  close: () => void;
};
type ControlModule = {
  createNativeReplayControls: (options: {
    root: HTMLElement;
    manifest: unknown;
    supportedRates: readonly number[];
    command: (
      action: (session: ReplaySession) => void | Promise<void>,
    ) => Promise<void>;
    initialState: ReplaySessionState;
    onError: (error: unknown) => void;
    signal: AbortSignal;
  }) => Promise<ControlOwner>;
};

/** Original control primitives bound to the shared player's owned SDK command. */
export function ScoutNativeReplayControls(props: {
  state: ReplaySessionState;
  supportedRates: readonly number[];
  resource: { url: string; bytes: number; sha256: string };
  command: (
    action: (session: ReplaySession) => void | Promise<void>,
  ) => Promise<void>;
}) {
  const target = useRef<HTMLDivElement>(null),
    owner = useRef<ControlOwner | null>(null),
    current = useRef(props.state);
  current.current = props.state;
  useEffect(() => {
    owner.current?.update(props.state);
  }, [props.state]);
  const { resource, supportedRates, command } = props;
  useEffect(() => {
    const root = target.current;
    if (!root) return;
    const abort = new AbortController();
    let owned: ControlOwner | null = null;
    const fail = (error: unknown) => {
      if (!abort.signal.aborted)
        void command(() => {
          throw error;
        });
    };
    const load = async () => {
      try {
        if (resource.bytes > 2 * 1024 * 1024)
          throw new Error("Original replay-control package is too large.");
        const bytes = await loadVerifiedReplaySource(resource, abort.signal),
          manifest: unknown = JSON.parse(new TextDecoder().decode(bytes)),
          source = "/research/latest-native-replay-controls.mjs",
          module = (await import(/* @vite-ignore */ source)) as ControlModule;
        abort.signal.throwIfAborted();
        owned = await module.createNativeReplayControls({
          root,
          manifest,
          supportedRates,
          command,
          initialState: current.current,
          onError: fail,
          signal: abort.signal,
        });
        if (abort.signal.aborted) owned.close();
        else {
          owner.current = owned;
          owned.update(current.current);
        }
      } catch (error) {
        fail(error);
      }
    };
    void load();
    return () => {
      abort.abort();
      owned?.close();
      if (owner.current === owned) owner.current = null;
    };
  }, [resource, supportedRates, command]);
  return <div ref={target} />;
}
