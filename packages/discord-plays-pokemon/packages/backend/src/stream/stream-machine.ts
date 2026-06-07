import type { PassThrough, Readable } from "node:stream";
import { assign, fromPromise, setup } from "xstate";
import { logger } from "#src/logger.ts";

// Live handles for one Go-Live broadcast. The PassThrough is the RGBA frame
// sink; `output` is ffmpeg's encoded output; `playing` resolves when the encode
// finishes (or rejects on SIGKILL when we tear the stream down). These are
// intentionally non-serializable — the machine is never persisted.
export type EncoderHandles = {
  sink: PassThrough;
  output: Readable;
  playing: Promise<void>;
};

// Side effects are injected so the machine is the pure sequencing layer and the
// real Discord/ffmpeg work lives in the facade (and is trivially mocked in
// tests). Each is a plain async function; the machine wraps them as actors.
export type StreamMachineDeps = {
  joinVoice: (signal: AbortSignal) => Promise<void>;
  prepareEncoder: () => Promise<EncoderHandles>;
  runStream: (
    handles: { output: Readable; playing: Promise<void> },
    signal: AbortSignal,
  ) => Promise<void>;
  leaveVoice: (playing: Promise<void> | null) => Promise<void>;
  // Bounded reconnect: after a failure the machine waits `retryDelayMs` and
  // retries up to `maxRetries` times before falling back to idle.
  maxRetries?: number;
  retryDelayMs?: number;
};

type StreamContext = {
  frameSink: PassThrough | null;
  encoder: EncoderHandles | null;
  retries: number;
  maxRetries: number;
  lastError: string | null;
};

type StreamEvent = { type: "START" } | { type: "STOP" };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The Go-Live stream lifecycle as an explicit machine. Replaces the hand-rolled
 * `active`/`rgba`/`playing`/`opChain` flag juggling in the old GameStreamer:
 *
 *   idle → starting (join voice) → preparing (build encoder) → streaming
 *        → stopping (tear down + leave voice) → idle
 *
 * Illegal transitions are impossible by construction: START is only handled in
 * `idle`/`failed`, so a second START while connecting/streaming is a no-op; STOP
 * from any active state routes through `stopping`, which always ends the frame
 * sink before leaving voice; and the actor's serialized event queue removes the
 * need for the old promise-chain mutex. `frameSink` is set on entry to
 * `streaming` and cleared on entry to `stopping`, both synchronously, so a frame
 * write never observes a half-wired stream.
 */
export function createStreamMachine(deps: StreamMachineDeps) {
  // An explicitly-annotated holder drives `setup({ types })` inference without an
  // `as` assertion (banned repo-wide). See memory reference_xstate_no_type_assertions.
  const machineTypes: {
    context: StreamContext;
    events: StreamEvent;
  } = {
    context: {
      frameSink: null,
      encoder: null,
      retries: 0,
      maxRetries: 0,
      lastError: null,
    },
    events: { type: "START" },
  };

  return setup({
    types: machineTypes,
    actors: {
      joinVoice: fromPromise(({ signal }: { signal: AbortSignal }) =>
        deps.joinVoice(signal),
      ),
      prepareEncoder: fromPromise(() => deps.prepareEncoder()),
      runStream: fromPromise(
        ({
          input,
          signal,
        }: {
          input: { output: Readable; playing: Promise<void> };
          signal: AbortSignal;
        }) => deps.runStream(input, signal),
      ),
      leaveVoice: fromPromise(
        ({ input }: { input: { playing: Promise<void> | null } }) =>
          deps.leaveVoice(input.playing),
      ),
    },
    guards: {
      canRetry: ({ context }) => context.retries < context.maxRetries,
      hasError: ({ context }) => context.lastError !== null,
    },
    delays: {
      retryDelay: deps.retryDelayMs ?? 2000,
    },
  }).createMachine({
    id: "stream",
    initial: "idle",
    context: {
      frameSink: null,
      encoder: null,
      retries: 0,
      maxRetries: deps.maxRetries ?? 3,
      lastError: null,
    },
    states: {
      idle: {
        entry: assign({
          frameSink: null,
          encoder: null,
          retries: 0,
          lastError: null,
        }),
        on: { START: "starting" },
      },

      // Joining voice. STOP here aborts the join (the actor's signal fires) and
      // routes through stopping to best-effort leave the channel.
      starting: {
        invoke: {
          src: "joinVoice",
          onDone: "preparing",
          onError: {
            target: "failed",
            actions: assign({
              lastError: ({ event }) => errorMessage(event.error),
            }),
          },
        },
        on: { STOP: "stopping" },
      },

      // Building the ffmpeg encoder + frame sink. We are already in voice, so a
      // failure (or STOP) routes through stopping to leave the channel.
      preparing: {
        invoke: {
          src: "prepareEncoder",
          onDone: {
            target: "streaming",
            actions: assign({
              encoder: ({ event }) => event.output,
              frameSink: ({ event }) => event.output.sink,
            }),
          },
          onError: {
            target: "stopping",
            actions: assign({
              lastError: ({ event }) => errorMessage(event.error),
            }),
          },
        },
        on: { STOP: "stopping" },
      },

      // Broadcasting. frameSink is live here and only here. If runStream
      // resolves on its own the stream died unexpectedly — treat it as an error
      // so the reconnect path runs.
      streaming: {
        entry: assign({ retries: 0, lastError: null }),
        invoke: {
          src: "runStream",
          input: ({ context }) => {
            const encoder = context.encoder;
            if (encoder === null) {
              throw new Error("invariant: encoder missing in streaming state");
            }
            return { output: encoder.output, playing: encoder.playing };
          },
          onDone: {
            target: "stopping",
            actions: assign({ lastError: "stream ended unexpectedly" }),
          },
          onError: {
            target: "stopping",
            actions: assign({
              lastError: ({ event }) => errorMessage(event.error),
            }),
          },
        },
        on: { STOP: "stopping" },
      },

      // Tearing down. End the frame sink first (so ffmpeg flushes and exits),
      // then leave voice once the encode promise settles. Branch to `failed`
      // (for reconnect) only if we got here via an error; a clean STOP has no
      // error and returns to idle.
      stopping: {
        // No `on` handler: events (STOP/START) delivered mid-teardown are
        // intentionally dropped by XState. The orchestrator reconciles the
        // desired state via onSnapshot once we land in idle/failed, so a direct
        // actor.send during `stopping` is a no-op by design.
        entry: [
          ({ context }) => {
            context.frameSink?.end();
          },
          assign({ frameSink: null }),
        ],
        invoke: {
          src: "leaveVoice",
          input: ({ context }) => ({
            playing: context.encoder?.playing ?? null,
          }),
          onDone: [{ guard: "hasError", target: "failed" }, { target: "idle" }],
          onError: [
            { guard: "hasError", target: "failed" },
            { target: "idle" },
          ],
        },
        exit: assign({ encoder: null }),
      },

      // Reconnect backoff. STOP cancels a pending retry; START retries
      // immediately (and resets the budget via idle/streaming entry).
      failed: {
        entry: [
          ({ context }) => {
            // Log before the increment below so the attempt number is computed
            // explicitly rather than depending on assign-vs-action ordering.
            const attempt = context.retries + 1;
            logger.error(
              `stream failed (attempt ${String(attempt)} of ${String(
                context.maxRetries,
              )}): ${context.lastError ?? "unknown"}`,
            );
          },
          assign({ retries: ({ context }) => context.retries + 1 }),
        ],
        on: {
          START: "starting",
          STOP: "idle",
        },
        after: {
          retryDelay: [
            { guard: "canRetry", target: "starting" },
            { target: "idle" },
          ],
        },
      },
    },
  });
}
