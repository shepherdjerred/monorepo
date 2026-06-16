// Maps a curated subset of MB_* metatile-behavior values from pokeemerald to
// short, human-readable descriptions for the goal prompt. The full enum has
// ~200 values; we surface only those that change the AI's next-action
// decision: warp arrows (= step here to use a staircase/door), tall grass
// (= encounter risk), ledge jumps, doors, water, and PCs. Everything else
// collapses to "normal floor".
//
// Source: include/constants/metatile_behaviors.h at tripplyons/pokeemerald-wasm@
// ed25aa7c5ae9c3c338cc9aa57c7150fc33255ad3 — values verified by enumerating
// the enum in commit order (positions are dense from 0, so the index ==
// the constant value).

const LABELS: Partial<Record<number, string>> = {
  // Encounter-trigger surfaces.
  0x02: "tall grass (battles possible)",
  0x03: "long grass (battles possible)",
  0x06: "deep sand",
  0x07: "short grass",
  0x08: "cave floor",
  0x0a: "no-running surface",
  0x0b: "indoor encounter tile",
  0x24: "ash grass (Route 113 ash)",
  // Water.
  0x10: "pond water (Surf required)",
  0x11: "interior deep water (Surf)",
  0x12: "deep water (Surf)",
  0x13: "waterfall",
  0x14: "Sootopolis deep water (Surf)",
  0x15: "ocean water (Surf)",
  0x16: "puddle",
  0x17: "shallow water",
  0x19: "no-surfacing zone",
  // Stairs (one specific case the engine flags directly).
  0x1b: "abandoned-ship stairs",
  0x1c: "Shoal Cave entrance",
  // Ice / sand / hot springs.
  0x20: "ice (slides until hit wall)",
  0x21: "sand",
  0x26: "thin ice (cracks)",
  0x27: "cracked ice (breaks on next step)",
  0x28: "hot springs",
  // Impassable hint walls.
  0x30: "wall to east",
  0x31: "wall to west",
  0x32: "wall to north",
  0x33: "wall to south",
  0xc0: "walls to north + south",
  0xc1: "walls to east + west",
  // Ledge jumps (one-way, walk into them to hop down).
  0x38: "ledge — jump east",
  0x39: "ledge — jump west",
  0x3a: "ledge — jump north",
  0x3b: "ledge — jump south",
  // Forced walks (auto-walk you in this direction).
  0x40: "auto-walk east",
  0x41: "auto-walk west",
  0x42: "auto-walk north",
  0x43: "auto-walk south",
  // Doors / ladders / warp arrows (the "stair entry" tiles — the KEY
  // case for the goal-mode stair confusion: standing on a south-arrow-warp
  // tile means pressing SOUTH will descend).
  0x60: "non-animated door (auto-warps on step)",
  0x61: "ladder",
  0x62: "warp arrow east — press east here to use this stair/door",
  0x63: "warp arrow west — press west here to use this stair/door",
  0x64: "warp arrow north — press north here to use this stair/door",
  0x65: "warp arrow south — press south here to use this stair/door",
  0x66: "cracked floor (will fall through)",
  0x69: "animated door (auto-warps on step)",
  0x6a: "up escalator",
  0x6b: "down escalator",
  0x6c: "water door",
  0x6d: "underwater south-arrow warp",
  // Bridges.
  0x70: "bridge over ocean",
  0x71: "bridge over pond (low)",
  0x72: "bridge over pond (mid)",
  0x73: "bridge over pond (high)",
  0x78: "Fortree bridge",
  0x7f: "bike bridge over barrier",
  // Interaction tiles.
  0x80: "shop counter",
  0x83: "PC (deposit/withdraw boxed Pokémon)",
  0x85: "region map",
  0x86: "television",
  0x87: "PokéBlock feeder",
  0x89: "slot machine",
  0x8a: "roulette",
  0x8b: "closed Sootopolis door",
  0x8c: "Trick House puzzle door",
  0x8d: "Petalburg gym door",
  0x8e: "running shoes instruction sign",
  0x8f: "questionnaire NPC",
  // Berry soil.
  0xa0: "berry tree soil (plant berries)",
  // Special.
  0xc5: "player's room PC (PC turned on)",
};

export function describeMetatileBehavior(raw: number): string {
  const label = LABELS[raw];
  if (label !== undefined) return label;
  return "normal floor";
}
