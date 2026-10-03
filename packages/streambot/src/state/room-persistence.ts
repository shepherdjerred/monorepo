import { z } from "zod";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import {
  PersistedStateSchema,
  deleteState,
  stateFilePath,
  type PersistedState,
} from "@shepherdjerred/streambot/state/persistence.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  type ChannelId,
  type GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import {
  PlaybackChannelNumberSchema,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";

export const PersistedRoomSchema = z
  .strictObject({
    version: z.literal(3),
    savedAt: z.number().int().nonnegative(),
    guildId: GuildIdSchema,
    channelId: ChannelIdSchema,
    slots: z.array(
      z.strictObject({
        number: PlaybackChannelNumberSchema,
        instanceId: z.string().min(1),
        state: PersistedStateSchema,
      }),
    ),
  })
  .superRefine((room, ctx) => {
    const numbers = new Set<number>();
    for (const slot of room.slots) {
      if (
        numbers.has(slot.number) ||
        slot.state.guildId !== room.guildId ||
        slot.state.channelId !== room.channelId
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Duplicate slot or inconsistent room identity",
        });
      }
      numbers.add(slot.number);
    }
  });
export type PersistedRoom = z.infer<typeof PersistedRoomSchema>;

export async function loadRoomState(
  file: string,
  maxAgeSeconds: number,
): Promise<PersistedRoom | null> {
  if (!(await Bun.file(file).exists())) return null;
  const raw: unknown = await Bun.file(file).json();
  // The old format is intentionally resumed through its existing mixed-queue path.
  if (PersistedStateSchema.safeParse(raw).success) return null;
  const room = PersistedRoomSchema.parse(raw);
  return Date.now() - room.savedAt > maxAgeSeconds * 1000 ? null : room;
}

/** One serial write queue and one atomic envelope per Discord voice channel. */
export class RoomPersistence {
  private readonly rooms = new Map<string, PersistedRoom>();
  private readonly tails = new Map<string, Promise<void>>();
  private readonly discarded = new Map<string, Set<PlaybackChannelNumber>>();
  constructor(private readonly dir: string) {}

  restore(room: PersistedRoom): Promise<void> {
    const file = stateFilePath(this.dir, room.guildId, room.channelId);
    // Concurrent sibling reconnects may read an older disk envelope while a checkpoint is
    // pending. The room coordinator's current memory remains authoritative once loaded.
    if (this.rooms.has(file)) return Promise.resolve();
    const discarded = this.discarded.get(file);
    const slots = room.slots.filter(
      (slot) => discarded?.has(slot.number) !== true,
    );
    this.rooms.set(file, { ...room, slots });
    return slots.length === room.slots.length
      ? Promise.resolve()
      : this.flush(file);
  }

  current(guildId: GuildId, channelId: ChannelId): PersistedRoom | undefined {
    return this.rooms.get(stateFilePath(this.dir, guildId, channelId));
  }

  isCurrent(
    room: PersistedRoom,
    slot: PersistedRoom["slots"][number],
  ): boolean {
    return (
      this.current(room.guildId, room.channelId)?.slots.some(
        (item) =>
          item.number === slot.number && item.instanceId === slot.instanceId,
      ) === true
    );
  }

  update(
    number: PlaybackChannelNumber,
    instanceId: string,
    state: PersistedState,
  ): Promise<void> {
    const file = stateFilePath(this.dir, state.guildId, state.channelId);
    this.discarded.get(file)?.delete(number);
    const previous = this.rooms.get(file);
    const slots =
      previous?.slots.filter((slot) => slot.number !== number) ?? [];
    const room: PersistedRoom = {
      version: 3,
      savedAt: Date.now(),
      guildId: state.guildId,
      channelId: state.channelId,
      slots: [...slots, { number, instanceId, state }].sort(
        (a, b) => a.number - b.number,
      ),
    };
    this.rooms.set(file, room);
    return this.flush(file);
  }

  remove(
    guildId: GuildId,
    channelId: ChannelId,
    number: PlaybackChannelNumber,
    instanceId: string,
  ): Promise<void> {
    const file = stateFilePath(this.dir, guildId, channelId);
    const room = this.rooms.get(file);
    if (room === undefined) return Promise.resolve();
    this.rooms.set(file, {
      ...room,
      savedAt: Date.now(),
      slots: room.slots.filter(
        (slot) => slot.number !== number || slot.instanceId !== instanceId,
      ),
    });
    return this.flush(file);
  }

  discard(
    guildId: GuildId,
    channelId: ChannelId,
    number: PlaybackChannelNumber,
  ): Promise<void> {
    const file = stateFilePath(this.dir, guildId, channelId);
    // A manual replacement can precede boot's disk read. Remember its retirement so
    // that a late restore cannot bring the previous instance back after an early stop.
    const discarded =
      this.discarded.get(file) ?? new Set<PlaybackChannelNumber>();
    discarded.add(number);
    this.discarded.set(file, discarded);
    const slot = this.rooms
      .get(file)
      ?.slots.find((item) => item.number === number);
    return slot === undefined
      ? Promise.resolve()
      : this.remove(guildId, channelId, number, slot.instanceId);
  }

  private flush(file: string): Promise<void> {
    const previous = this.tails.get(file) ?? Promise.resolve();
    const next = (async () => {
      await previous;
      const room = this.rooms.get(file);
      if (room === undefined) throw new Error("Missing room snapshot");
      if (room.slots.length === 0) {
        await deleteState(file);
        return;
      }
      PersistedRoomSchema.parse(room);
      await mkdir(path.dirname(file), { recursive: true });
      await Bun.write(`${file}.tmp`, JSON.stringify(room));
      await rename(`${file}.tmp`, file);
    })();
    this.tails.set(
      file,
      (async () => {
        try {
          await next;
        } catch {
          /* Caller observes this write; a later write may recover. */
        }
      })(),
    );
    return next;
  }
}
