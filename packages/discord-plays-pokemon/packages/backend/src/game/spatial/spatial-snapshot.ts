// Reads spatial state (player position, facing, current-tile behavior, nearby
// NPCs/items) from pokeemerald-wasm via gPlayerAvatar + gObjectEvents. Fed
// into the Codex goal prompt so the AI knows what's around it instead of
// inferring everything from screenshot pixels.
//
// Struct offsets verified against tripplyons/pokeemerald-wasm@
// ed25aa7c5ae9c3c338cc9aa57c7150fc33255ad3 (include/global.fieldmap.h,
// include/global.h, include/constants/global.h). Direction values from
// include/constants/global.h DIR_* macros.

import type { MemoryReader } from "#src/emulator/memory.ts";
import type { GameSymbols } from "#src/emulator/symbols.ts";
import { describeMetatileBehavior } from "./metatile-behaviors.ts";

// include/constants/global.h
const OBJECT_EVENTS_COUNT = 16;
// struct ObjectEvent { /*size = 0x24*/ } in include/global.fieldmap.h.
const OBJECT_EVENT_SIZE = 0x24;
// PlayerAvatar { u8 objectEventId @ 0x05 } in include/global.fieldmap.h.
const PLAYER_AVATAR_OBJECT_EVENT_ID_OFFSET = 0x05;
// PlayerAvatar { u8 flags @ 0x00 }. runningState lives at 0x02 but we read
// the movement flags from `flags` directly instead, which covers bike /
// surfing / dash / on-foot cleanly without needing the parallel field.
const PLAYER_AVATAR_FLAGS_OFFSET = 0x00;
// PlayerAvatar size — well over the fields we read. SaveBlock1 unused here
// (we get position + map from the player's ObjectEvent).
const PLAYER_AVATAR_MIN_SIZE = 0x06;

// ObjectEvent field offsets (see include/global.fieldmap.h struct ObjectEvent).
// /*0x00*/ u32 active:1, ... (bit 0 of byte 0)
const OE_ACTIVE_OFFSET = 0x00;
const OE_ACTIVE_MASK = 0x01;
// /*0x02*/ u32 isPlayer:1, ... (bit 0 of byte 2)
const OE_ISPLAYER_OFFSET = 0x02;
const OE_ISPLAYER_MASK = 0x01;
// /*0x02*/ ... u32 invisible:1 @ bit 5 of byte 2 (bit offset 0x15 from base)
const OE_INVISIBLE_OFFSET = 0x02;
const OE_INVISIBLE_MASK = 0x20;
// /*0x05*/ u8 graphicsId
const OE_GRAPHICS_ID_OFFSET = 0x05;
// /*0x09*/ u8 mapNum
const OE_MAP_NUM_OFFSET = 0x09;
// /*0x0A*/ u8 mapGroup
const OE_MAP_GROUP_OFFSET = 0x0a;
// /*0x10*/ struct Coords16 currentCoords { s16 x; s16 y; }
const OE_CURRENT_COORDS_X_OFFSET = 0x10;
const OE_CURRENT_COORDS_Y_OFFSET = 0x12;
// /*0x18*/ u16 facingDirection:4, ... (low 4 bits of u16 at 0x18)
const OE_FACING_OFFSET = 0x18;
const OE_FACING_MASK = 0x0f;
// /*0x1E*/ u8 currentMetatileBehavior
const OE_METATILE_BEHAVIOR_OFFSET = 0x1e;

// include/constants/global.h DIR_* — only the cardinal four matter for prompt
// readability; we drop diagonals and "none" to "(unknown)" since they only
// appear during transition frames.
const DIR_SOUTH = 1;
const DIR_NORTH = 2;
const DIR_WEST = 3;
const DIR_EAST = 4;

export type Facing = "north" | "south" | "east" | "west" | "unknown";

export type NearbyObject = {
  // Manhattan dx/dy from player; positive dx is east, positive dy is south
  // (pokeemerald convention — y increases downward).
  dx: number;
  dy: number;
  manhattan: number;
  facing: Facing;
  // Soft classification. Most sprites are NPCs; ITEM_BALL/CUTTABLE_TREE/
  // BREAKABLE_ROCK are the actionable map decorations we want to highlight.
  kind: "npc" | "item" | "tree" | "rock";
  graphicsId: number;
};

export type SpatialSnapshot = {
  // Tile coords on the current map (raw engine values — origin is the
  // top-left including the +7 camera padding, so they are not "0-based map
  // origin"; consistency matters more than absolute meaning for the prompt).
  x: number;
  y: number;
  facing: Facing;
  // Whether the player is on the bike or surfing (flags bitfield from
  // PlayerAvatar). Surfaced as a short human label or "on foot".
  movementMode: string;
  mapGroup: number;
  mapNum: number;
  // Decoded label of the metatile the player is *currently standing on*. We
  // can't peek the tile ahead without gMapHeader (not exported by the
  // current wasm), but the current-tile behavior catches the case where
  // the player has stepped onto a warp arrow / animated door / ledge / tall
  // grass — common moments where the AI gets confused.
  onTileBehavior: string;
  nearby: readonly NearbyObject[];
};

const NEARBY_RADIUS = 5;
const NEARBY_LIMIT = 6;

function validPointer(addr: number, size: number, memorySize: number): boolean {
  return addr >= 0x10_00 && addr + size <= memorySize;
}

function decodeFacing(raw: number): Facing {
  switch (raw) {
    case DIR_SOUTH:
      return "south";
    case DIR_NORTH:
      return "north";
    case DIR_WEST:
      return "west";
    case DIR_EAST:
      return "east";
    default:
      return "unknown";
  }
}

// include/constants/field_player_avatar.h — the PLAYER_AVATAR_FLAG_* bits.
// We only care about the visible distinct modes for the prompt; everything
// else collapses to "on foot".
const PA_FLAG_MACH_BIKE = 0x01;
const PA_FLAG_ACRO_BIKE = 0x02;
const PA_FLAG_SURFING = 0x04;
const PA_FLAG_UNDERWATER = 0x08;
const PA_FLAG_CONTROLLABLE = 0x10;
const PA_FLAG_FORCED = 0x20;
const PA_FLAG_DASH = 0x40;
const PA_FLAG_ON_FOOT = 0x80;

function describeMovementMode(flags: number): string {
  if ((flags & PA_FLAG_SURFING) !== 0) return "surfing";
  if ((flags & PA_FLAG_UNDERWATER) !== 0) return "diving";
  if ((flags & (PA_FLAG_MACH_BIKE | PA_FLAG_ACRO_BIKE)) !== 0) return "biking";
  if ((flags & PA_FLAG_DASH) !== 0) return "running";
  if (
    (flags & (PA_FLAG_ON_FOOT | PA_FLAG_CONTROLLABLE | PA_FLAG_FORCED)) !==
    0
  ) {
    return "on foot";
  }
  return "on foot";
}

// Distinctive graphics IDs for actionable objects (the AI cares about these).
// Source: include/constants/event_objects.h.
const OBJ_GFX_ITEM_BALL = 59;
const OBJ_GFX_CUTTABLE_TREE = 82;
const OBJ_GFX_BREAKABLE_ROCK = 86;

function classify(graphicsId: number): NearbyObject["kind"] {
  switch (graphicsId) {
    case OBJ_GFX_ITEM_BALL:
      return "item";
    case OBJ_GFX_CUTTABLE_TREE:
      return "tree";
    case OBJ_GFX_BREAKABLE_ROCK:
      return "rock";
    default:
      return "npc";
  }
}

/**
 * Read the live spatial snapshot, or null when the game isn't in a readable
 * state (no save loaded, mid-relocation, or the player ObjectEvent is
 * inactive — e.g. title screen, intro cutscene).
 */
export function readSpatialSnapshot(
  reader: MemoryReader,
  symbols: GameSymbols,
): SpatialSnapshot | null {
  const avatar = symbols.gPlayerAvatar;
  if (!validPointer(avatar, PLAYER_AVATAR_MIN_SIZE, reader.byteLength)) {
    return null;
  }
  const objectEventId = reader.u8(
    avatar + PLAYER_AVATAR_OBJECT_EVENT_ID_OFFSET,
  );
  if (objectEventId >= OBJECT_EVENTS_COUNT) {
    return null;
  }

  const eventsBase = symbols.gObjectEvents;
  const arraySize = OBJECT_EVENTS_COUNT * OBJECT_EVENT_SIZE;
  if (!validPointer(eventsBase, arraySize, reader.byteLength)) {
    return null;
  }
  const playerBase = eventsBase + objectEventId * OBJECT_EVENT_SIZE;
  const playerActive =
    (reader.u8(playerBase + OE_ACTIVE_OFFSET) & OE_ACTIVE_MASK) !== 0;
  if (!playerActive) {
    return null;
  }

  const flags = reader.u8(avatar + PLAYER_AVATAR_FLAGS_OFFSET);

  const x = reader.s16(playerBase + OE_CURRENT_COORDS_X_OFFSET);
  const y = reader.s16(playerBase + OE_CURRENT_COORDS_Y_OFFSET);
  const facingWord = reader.u16(playerBase + OE_FACING_OFFSET);
  const facing = decodeFacing(facingWord & OE_FACING_MASK);
  const mapGroup = reader.u8(playerBase + OE_MAP_GROUP_OFFSET);
  const mapNum = reader.u8(playerBase + OE_MAP_NUM_OFFSET);
  const onTileBehaviorRaw = reader.u8(playerBase + OE_METATILE_BEHAVIOR_OFFSET);

  // Walk the ObjectEvent array and pick out active, same-map, non-invisible,
  // non-player events within NEARBY_RADIUS tiles. Sort by manhattan distance
  // then cap to NEARBY_LIMIT so the prompt line stays compact.
  const all: NearbyObject[] = [];
  for (let i = 0; i < OBJECT_EVENTS_COUNT; i++) {
    if (i === objectEventId) continue;
    const base = eventsBase + i * OBJECT_EVENT_SIZE;
    if ((reader.u8(base + OE_ACTIVE_OFFSET) & OE_ACTIVE_MASK) === 0) continue;
    if ((reader.u8(base + OE_ISPLAYER_OFFSET) & OE_ISPLAYER_MASK) !== 0) {
      continue;
    }
    if ((reader.u8(base + OE_INVISIBLE_OFFSET) & OE_INVISIBLE_MASK) !== 0) {
      continue;
    }
    if (reader.u8(base + OE_MAP_GROUP_OFFSET) !== mapGroup) continue;
    if (reader.u8(base + OE_MAP_NUM_OFFSET) !== mapNum) continue;
    const ox = reader.s16(base + OE_CURRENT_COORDS_X_OFFSET);
    const oy = reader.s16(base + OE_CURRENT_COORDS_Y_OFFSET);
    const dx = ox - x;
    const dy = oy - y;
    const manhattan = Math.abs(dx) + Math.abs(dy);
    if (manhattan === 0 || manhattan > NEARBY_RADIUS) continue;
    const facingRaw = reader.u16(base + OE_FACING_OFFSET) & OE_FACING_MASK;
    const graphicsId = reader.u8(base + OE_GRAPHICS_ID_OFFSET);
    all.push({
      dx,
      dy,
      manhattan,
      facing: decodeFacing(facingRaw),
      kind: classify(graphicsId),
      graphicsId,
    });
  }
  all.sort((a, b) => a.manhattan - b.manhattan);

  return {
    x,
    y,
    facing,
    movementMode: describeMovementMode(flags),
    mapGroup,
    mapNum,
    onTileBehavior: describeMetatileBehavior(onTileBehaviorRaw),
    nearby: all.slice(0, NEARBY_LIMIT),
  };
}
