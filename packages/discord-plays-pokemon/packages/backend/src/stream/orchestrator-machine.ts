import type { PassThrough } from "node:stream";
import { assign, enqueueActions, sendTo, setup } from "xstate";
import {
  createStreamMachine,
  type StreamMachineDeps,
} from "./stream-machine.ts";

type OrchestratorContext = {
  // What we *want*: stream up while the channel is occupied.
  desired: boolean;
  // Mirror of the child's live frame sink, for the per-frame hot path.
  frameSink: PassThrough | null;
};

type OrchestratorEvent = { type: "SET_DESIRED"; desired: boolean };

/**
 * Reconciles desired-state (derived from channel occupancy) against the child
 * stream machine. This is what makes occupancy "flapping" safe: rapid
 * join/leave/join collapses to the final desired state.
 *
 * - SET_DESIRED forwards START/STOP to the child immediately; redundant ones are
 *   no-ops thanks to the child's own state guards.
 * - `onSnapshot` watches every child transition and reconciles: if the child is
 *   back to idle but we still want a stream (a START that arrived mid-`stopping`,
 *   or a give-up after exhausting retries), (re)start it; if the child came up
 *   streaming but we no longer want it (a STOP that arrived mid-`starting`),
 *   stop it. It also mirrors the child's live `frameSink` for the hot path.
 *
 * Observing the child via `onSnapshot` (rather than the child sending events to
 * its parent) keeps the stream machine pure and runnable standalone.
 */
export function createOrchestratorMachine(deps: StreamMachineDeps) {
  const streamMachine = createStreamMachine(deps);

  const machineTypes: {
    context: OrchestratorContext;
    events: OrchestratorEvent;
  } = {
    context: { desired: false, frameSink: null },
    events: { type: "SET_DESIRED", desired: false },
  };

  return setup({
    types: machineTypes,
    actors: { stream: streamMachine },
  }).createMachine({
    id: "orchestrator",
    context: { desired: false, frameSink: null },
    invoke: {
      src: "stream",
      id: "stream",
      onSnapshot: {
        actions: enqueueActions(({ context, event, enqueue }) => {
          const child = event.snapshot;
          enqueue.assign({ frameSink: child.context.frameSink });
          if (child.matches("idle") && context.desired) {
            enqueue.sendTo("stream", { type: "START" });
          } else if (child.matches("streaming") && !context.desired) {
            enqueue.sendTo("stream", { type: "STOP" });
          }
        }),
      },
    },
    on: {
      SET_DESIRED: {
        actions: [
          assign({ desired: ({ event }) => event.desired }),
          sendTo("stream", ({ event }) => ({
            type: event.desired ? "START" : "STOP",
          })),
        ],
      },
    },
  });
}
