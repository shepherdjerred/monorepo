import type { PlaybackActors } from "@shepherdjerred/streambot/machine/playback-machine.ts";
import type {
  ResolvedSource,
  ResolveSourceInput,
} from "@shepherdjerred/streambot/machine/types.ts";
import type { UserbotEntry } from "@shepherdjerred/streambot/pool/userbot-pool.ts";
import type { TeardownHold } from "@shepherdjerred/streambot/session/teardown-hold.ts";

export type PlaybackActorDeps = {
  readonly entry: UserbotEntry;
  readonly resolveSource: (
    input: ResolveSourceInput,
    signal: AbortSignal,
  ) => Promise<ResolvedSource>;
  /** Read lazily: the hold belongs to the session record, which needs the actors to exist first. */
  readonly teardownHold: () => TeardownHold;
};

/**
 * The playback machine's I/O actors, bound to one pooled userbot.
 *
 * `leaveVoice` closes the normal voice connection the assistant speaks over. A voice `stop`
 * dispatches STOP from inside its own transaction, so disconnecting the moment the machine reaches
 * `leaving` would cut the spoken confirmation off mid-reply. Waiting on the same hold that defers
 * teardown keeps the connection up until the transaction releases it; that hold is bounded by the
 * voice transaction timeout, and the machine's leave wedge guard still catches a genuinely hung
 * disconnect.
 */
export function buildPlaybackActors(deps: PlaybackActorDeps): PlaybackActors {
  return {
    joinVoice: deps.entry.userbot.joinVoice,
    resolveSource: deps.resolveSource,
    runStream: deps.entry.userbot.runStream,
    leaveVoice: async (input, signal) => {
      // The drain must honor the invoke's abort: a voice-transaction hold can legitimately last
      // longer (30 s budget) than the machine's leaving-state wedge guard (10 s), and a leave
      // that outlives its abort could disconnect a session that has already moved on.
      await Promise.race([
        deps.teardownHold().drain(),
        new Promise<never>((_resolve, reject) => {
          const rejectAbort = () => {
            reject(
              signal.reason instanceof Error
                ? signal.reason
                : new Error("Voice leave aborted"),
            );
          };
          if (signal.aborted) {
            rejectAbort();
            return;
          }
          signal.addEventListener("abort", rejectAbort, { once: true });
        }),
      ]);
      await deps.entry.userbot.leaveVoice(input, signal);
    },
  };
}
