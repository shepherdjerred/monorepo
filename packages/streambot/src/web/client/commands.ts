import type {
  MediaSelectionSchema,
  WebCommand,
  WebCommandResult,
  WebRoom,
  WebRoomPlayer,
  WebTransport,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { z } from "zod";

export type MediaSelection = z.infer<typeof MediaSelectionSchema>;
export type Placement = "queue" | "next" | "now";

/** Where commands go: the viewer's detected voice channel. `null` when they are in none. */
export type RoomTarget = {
  readonly guildId: string;
  readonly channelId: string;
  readonly voiceChannelName: string;
  /**
   * A room without numbered slots has one mixed queue; the server then refuses any named slot, so
   * commands leave `playbackChannel` null and Listen/Watch only set each item's mode.
   */
  readonly legacy: boolean;
  /** The free slot "Start another stream" uses, when one exists. */
  readonly extraSlot: number | null;
};

const AUDIO_SLOT = 1;
const VIDEO_SLOT = 2;

export function roomTarget(room: WebRoom): RoomTarget | null {
  if (room.location === null) return null;
  const legacy = room.capacity.maxSlots === 1;
  const occupied = new Set(room.players.map((player) => player.slot));
  let extraSlot: number | null = null;
  if (!legacy && room.capacity.extraStreamAvailable)
    for (let slot = VIDEO_SLOT + 1; slot <= room.capacity.maxSlots; slot += 1)
      if (!occupied.has(slot)) {
        extraSlot = slot;
        break;
      }
  return {
    guildId: room.location.guild.id,
    channelId: room.location.channel.id,
    voiceChannelName: room.location.channel.name,
    legacy,
    extraSlot,
  };
}

function base(
  target: RoomTarget,
  slot: number | null,
  revision: string | null,
) {
  return {
    guildId: target.guildId,
    channelId: target.channelId,
    revision,
    playbackChannel: target.legacy ? null : slot,
    selectionVersion: null,
    slotRevisions: {},
    targeting: "explicit" as const,
  };
}

/** A play request. The button is the destination: Listen and Watch each name their transport. */
export function playCommand(
  target: RoomTarget,
  input: {
    selection: MediaSelection;
    transport: WebTransport;
    placement: Placement;
    /** Start a further simultaneous stream on the free extra slot. */
    anotherStream?: boolean;
  },
): WebCommand {
  const slot =
    input.anotherStream === true && input.transport === "watch"
      ? target.extraSlot
      : null;
  return {
    ...base(target, slot, null),
    action: "play",
    selection: input.selection,
    placement: input.placement,
    transport: input.transport,
  };
}

export type PlayerAction =
  | { action: "pause" | "resume" | "skip" }
  | { action: "stop" | "clear" | "shuffle" }
  | { action: "seek"; seconds: number }
  | { action: "volume"; percent: number }
  | { action: "loop"; mode: "off" | "track" | "queue" }
  | { action: "remove"; position: number }
  | { action: "move"; from: number; to: number }
  | { action: "subtitles"; token: string };

/**
 * A control aimed at one player card. Transport controls carry the current item's token, so a
 * click on an item that has since finished is refused instead of skipping the next one; queue
 * edits carry the revision the viewer saw.
 */
export function playerCommand(
  target: RoomTarget,
  player: Pick<WebRoomPlayer, "slot" | "revision" | "current">,
  action: PlayerAction,
): WebCommand {
  const common = base(target, player.slot, player.revision);
  const token = player.current?.token;
  const aimedAtCurrent =
    action.action === "pause" ||
    action.action === "resume" ||
    action.action === "skip" ||
    action.action === "seek";
  return {
    ...common,
    ...action,
    ...(aimedAtCurrent && token !== undefined ? { expectCurrent: token } : {}),
  };
}

export type StationRequest =
  | {
      mode: "radio" | "tv";
      scope: "room" | "mine" | "server";
      seed?: string;
      tvPreset?:
        "my-mix" | "continue-series" | "sitcoms" | "movies" | "youtube";
    }
  | { mode: "off"; slot: number };

/** Radio plays on the Listen slot and TV on the Watch slot; Stop names the card's own slot. */
export function stationCommand(
  target: RoomTarget,
  request: StationRequest,
): WebCommand {
  if (request.mode === "off")
    return {
      ...base(target, request.slot, null),
      action: "station",
      mode: "off",
    };
  return {
    ...base(target, request.mode === "radio" ? AUDIO_SLOT : VIDEO_SLOT, null),
    action: "station",
    mode: request.mode,
    scope: request.scope,
    ...(request.seed === undefined || request.seed.trim() === ""
      ? {}
      : { seed: request.seed.trim() }),
    ...(request.tvPreset === undefined ? {} : { tvPreset: request.tvPreset }),
  };
}

export const TRANSPORT_NAME: Readonly<Record<WebTransport, string>> = {
  listen: "Listen",
  watch: "Watch",
};

/** The inline confirmation for a successful play, worded from where the server says it went. */
export function playConfirmation(
  result: WebCommandResult,
  requested: WebTransport,
): string {
  const transport = result.destination?.transport ?? requested;
  const place = result.destination?.voiceChannelName;
  if (result.position === undefined) return result.message;
  if (result.position === 0)
    return (
      (transport === "listen" ? "Now playing" : "Now streaming") +
      (place === undefined ? "" : " in " + place)
    );
  return `Added to ${TRANSPORT_NAME[transport]} queue · #${String(result.position)}`;
}
