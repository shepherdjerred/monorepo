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
  target: JoinVoiceInput | null;
  closing: Promise<void> | null;
};

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
    lane.joinVoice = (input: JoinVoiceInput, signal: AbortSignal) => {
      owner.target = input;
      owner.joined ??= (async () => {
        try {
          return await join(input, signal);
        } catch (error) {
          owner.joined = null;
          throw error;
        }
      })();
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
      await entry.userbot.destroy();
      try {
        await owner.joined;
      } catch {
        // A failed join still needs connection cleanup before reuse.
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
