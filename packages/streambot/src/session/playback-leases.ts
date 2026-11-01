import type {
  UserbotEntry,
  UserbotProvider,
} from "@shepherdjerred/streambot/pool/userbot-pool.ts";
import type { StreamerLike } from "@shepherdjerred/streambot/streamer/streamer-types.ts";
import type {
  JoinVoiceInput,
  VoiceHandle,
} from "@shepherdjerred/streambot/machine/types.ts";
import type { VoiceCloseInfo } from "@shepherdjerred/streambot/streamer/voice-close-source.ts";
import {
  playbackTransport,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";

const VOICE_JOIN_ABORTED = "Voice join aborted";

type Lease = {
  room: string;
  group: number;
  physical: UserbotEntry;
  children: Map<
    UserbotEntry,
    {
      number: PlaybackChannelNumber;
      close: ((info: VoiceCloseInfo) => void) | null;
    }
  >;
  joined: Promise<VoiceHandle> | null;
  /** Cancels an in-flight shared handshake when the last holder leaves. */
  joinAbort: AbortController | null;
  target: JoinVoiceInput | null;
  closing: Promise<void> | null;
};

function joinAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(VOICE_JOIN_ABORTED);
}

/**
 * Channels 1 and 2 share one handshake. A slot's machine aborts its own signal
 * when that slot leaves `joining`, including after a successful join, so
 * cancellation belongs to the lease: only the last holder may abandon it.
 * The race settles even when `join` ignores the signal, which is what used to
 * pin the only account after the session had already ended.
 */
function sharedVoiceJoin(
  join: StreamerLike["joinVoice"],
  input: JoinVoiceInput,
  controller: AbortController,
  onFailure: () => void,
): Promise<VoiceHandle> {
  // One settlement, the same as `await join()`. Promise.race adds a turn, and
  // a play command returns before that extra turn promotes the queued item.
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      controller.signal.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = () => {
      finish(() => {
        reject(joinAbortError(controller.signal));
      });
    };
    if (controller.signal.aborted) {
      onAbort();
      return;
    }
    controller.signal.addEventListener("abort", onAbort, { once: true });
    void (async () => {
      try {
        const handle = await join(input, controller.signal);
        finish(() => {
          resolve(handle);
        });
      } catch (error) {
        finish(() => {
          if (!controller.signal.aborted) onFailure();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      }
    })();
  });
}

/** The pool remains account-exclusive. Only this room-local lease shares 1+2. */
export class PlaybackLeases {
  private readonly leases = new Set<Lease>();
  private readonly owners = new Map<UserbotEntry, Lease>();
  constructor(private readonly pool: UserbotProvider) {}

  acquire(
    room: string,
    guildId: string,
    number: PlaybackChannelNumber,
  ): UserbotEntry | null {
    const group = number <= 2 ? 1 : number;
    let lease = [...this.leases].find(
      (candidate) =>
        candidate.room === room &&
        candidate.group === group &&
        candidate.closing === null,
    );
    let fresh = false;
    if (lease === undefined) {
      const physical = this.pool.acquire(guildId);
      if (physical === null) return null;
      lease = {
        room,
        group,
        physical,
        children: new Map(),
        joined: null,
        joinAbort: null,
        target: null,
        closing: null,
      };
      fresh = true;
    }
    const owner = lease;
    const create = owner.physical.userbot.createPlaybackHandle;
    if (create === undefined) {
      if (fresh) this.pool.release(owner.physical);
      throw new Error(
        "Numbered playback requires independent streamer handles",
      );
    }
    let lane: StreamerLike;
    try {
      lane = create.call(owner.physical.userbot, playbackTransport(number));
    } catch (error) {
      if (fresh) this.pool.release(owner.physical);
      throw error;
    }
    const entry: UserbotEntry = {
      userbot: lane,
      guildIds: owner.physical.guildIds,
      busy: true,
    };
    const child: {
      number: PlaybackChannelNumber;
      close: ((info: VoiceCloseInfo) => void) | null;
    } = { number, close: null };
    const join = owner.physical.userbot.joinVoice;
    lane.joinVoice = (input: JoinVoiceInput, _signal: AbortSignal) => {
      owner.target = input;
      if (owner.joined === null) {
        const controller = new AbortController();
        owner.joinAbort = controller;
        owner.joined = sharedVoiceJoin(join, input, controller, () => {
          owner.joined = null;
        });
      }
      return owner.joined;
    };
    lane.setVoiceCloseListener = (listener) => {
      child.close = listener;
    };
    owner.children.set(entry, child);
    this.owners.set(entry, owner);
    if (fresh) {
      this.leases.add(owner);
      owner.physical.userbot.setVoiceCloseListener((info) => {
        for (const item of owner.children.values()) {
          if (info.source !== "go-live" || item.number !== 1)
            item.close?.(info);
        }
      });
    }
    return entry;
  }

  /** Disconnect and release only after the last playback/assistant holder has drained. */
  async release(entry: UserbotEntry): Promise<void> {
    const owner = this.owners.get(entry);
    if (owner === undefined) throw new Error("Unknown playback lease");
    this.owners.delete(entry);
    owner.children.delete(entry);
    entry.busy = false;
    if (owner.children.size > 0) {
      await entry.userbot.destroy();
      return;
    }
    owner.closing = (async () => {
      // Abort before waiting. A handshake Discord never answers used to stay
      // pending here, and the only account stayed leased after the session ended.
      const pending = owner.joined;
      owner.joinAbort?.abort(new Error(VOICE_JOIN_ABORTED));
      await entry.userbot.destroy();
      try {
        await pending;
      } catch {
        // A failed or cancelled join still needs connection cleanup before reuse.
      }
      owner.physical.userbot.setVoiceCloseListener(null);
      if (owner.target !== null) {
        await owner.physical.userbot.leaveVoice(
          { voice: owner.target },
          new AbortController().signal,
        );
      }
      this.leases.delete(owner);
      this.pool.release(owner.physical);
    })();
    await owner.closing;
  }

  physical(entry: UserbotEntry): StreamerLike {
    const owner = this.owners.get(entry);
    if (owner === undefined) throw new Error("Unknown playback lease");
    return owner.physical.userbot;
  }

  /** Shutdown also waits for accounts whose final child already left the session map. */
  async drain(): Promise<void> {
    const closing = [...this.leases].map((lease) => {
      if (lease.closing === null)
        throw new Error("Active playback lease remained after shutdown");
      return lease.closing;
    });
    await Promise.all(closing);
  }

  move(
    entry: UserbotEntry,
    room: string,
    channelId: JoinVoiceInput["channelId"],
  ): void {
    const owner = this.owners.get(entry);
    if (owner === undefined) throw new Error("Unknown playback lease");
    owner.room = room;
    if (owner.target !== null) owner.target = { ...owner.target, channelId };
  }
}
