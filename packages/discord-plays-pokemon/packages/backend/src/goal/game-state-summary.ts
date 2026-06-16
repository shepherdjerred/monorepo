// Pure formatter: GameSnapshot (+ optional SpatialSnapshot) → multi-line
// human-readable text that gets inlined into the Codex goal prompt. Kept
// separate from snapshot.ts so the goal-mode prompt can evolve without
// touching the event-watcher path.

import { BADGES } from "#src/game/events/data/badges.ts";
import { speciesName } from "#src/game/events/generated/species.ts";
import type { GameSnapshot } from "#src/game/events/types.ts";
import { mapName } from "#src/game/spatial/generated/map-names.ts";
import type {
  NearbyObject,
  SpatialSnapshot,
} from "#src/game/spatial/spatial-snapshot.ts";

const NO_SNAPSHOT_MESSAGE =
  "Game state unavailable (no save loaded or mid-relocation).";

export function formatGameStateForPrompt(
  snapshot: GameSnapshot | null,
  spatial: SpatialSnapshot | null = null,
): string {
  if (snapshot === null) {
    return NO_SNAPSHOT_MESSAGE;
  }

  const lines: string[] = [];
  lines.push(formatPartyLine(snapshot));
  lines.push(formatBadgesLine(snapshot));
  lines.push(formatDexLine(snapshot));
  lines.push(formatLastCatchLine(snapshot));
  if (spatial !== null) {
    lines.push(formatLocationLine(spatial));
    lines.push(formatOnTileLine(spatial));
    lines.push(...formatNearbyLines(spatial));
  }
  return lines.join("\n");
}

function formatPartyLine(snapshot: GameSnapshot): string {
  const party = snapshot.party.filter((mon) => !mon.isEgg);
  if (party.length === 0) {
    return "Party: empty";
  }
  const formatted = party.map((mon) => formatPartyMon(mon)).join(", ");
  return `Party: ${formatted}`;
}

function formatPartyMon(mon: GameSnapshot["party"][number]): string {
  const name = titleCase(speciesName(mon.species));
  // Show nickname only if the trainer set one different from the species name.
  const speciesUpper = speciesName(mon.species).toUpperCase();
  const showNickname =
    mon.nickname.length > 0 && mon.nickname.toUpperCase() !== speciesUpper;
  const displayName = showNickname ? `${name} "${mon.nickname}"` : name;
  return `${displayName} L${String(mon.level)} (HP ${String(mon.hp)}/${String(mon.maxHp)})`;
}

function formatBadgesLine(snapshot: GameSnapshot): string {
  const earned: string[] = [];
  const cap = Math.min(snapshot.badges.length, BADGES.length);
  for (let i = 0; i < cap; i += 1) {
    if (!snapshot.badges[i]) continue;
    earned.push(BADGES[i].name.replace(/ Badge$/, ""));
  }
  const count = earned.length;
  const total = BADGES.length;
  if (count === 0) {
    return `Badges (0/${String(total)}): none`;
  }
  return `Badges (${String(count)}/${String(total)}): ${earned.join(", ")}`;
}

function formatDexLine(snapshot: GameSnapshot): string {
  return `Pokédex owned: ${String(countDexOwned(snapshot.dexOwned))}`;
}

function formatLastCatchLine(snapshot: GameSnapshot): string {
  if (snapshot.caughtMonSpecies === 0) {
    return "Last caught: none recorded this session";
  }
  const name = titleCase(speciesName(snapshot.caughtMonSpecies));
  const shiny = snapshot.caughtMonShiny ? "yes" : "no";
  return `Last caught: ${name} (shiny: ${shiny})`;
}

function countDexOwned(bitfield: Uint8Array): number {
  let total = 0;
  for (const byte of bitfield) {
    total += popcount8(byte);
  }
  return total;
}

function popcount8(byte: number): number {
  // Standard popcount on a byte. Branchless, no lookup table required.
  let n = byte & 0xff;
  n = n - ((n >> 1) & 0x55);
  n = (n & 0x33) + ((n >> 2) & 0x33);
  return (n + (n >> 4)) & 0x0f;
}

function formatLocationLine(spatial: SpatialSnapshot): string {
  const name = mapName(spatial.mapGroup, spatial.mapNum);
  return `Location: ${name} @ (${String(spatial.x)}, ${String(spatial.y)}) facing ${spatial.facing}, ${spatial.movementMode}`;
}

function formatOnTileLine(spatial: SpatialSnapshot): string {
  return `Standing on: ${spatial.onTileBehavior}`;
}

function formatNearbyLines(spatial: SpatialSnapshot): readonly string[] {
  if (spatial.nearby.length === 0) {
    return ["Nearby objects: none within 5 tiles"];
  }
  const header = "Nearby objects (sorted by distance, dx=east, dy=south):";
  const entries = spatial.nearby.map((obj) => formatNearbyEntry(obj));
  return [header, ...entries];
}

function formatNearbyEntry(obj: NearbyObject): string {
  const direction = describeRelative(obj.dx, obj.dy);
  const kindLabel = describeKind(obj.kind, obj.graphicsId);
  const facingHint = obj.facing === "unknown" ? "" : `, facing ${obj.facing}`;
  return `  - ${kindLabel} ${direction} (dx=${String(obj.dx)}, dy=${String(obj.dy)})${facingHint}`;
}

function describeKind(kind: NearbyObject["kind"], graphicsId: number): string {
  switch (kind) {
    case "item":
      return "ITEM (Poké Ball on the ground)";
    case "tree":
      return "CUTTABLE TREE (needs HM Cut)";
    case "rock":
      return "BREAKABLE ROCK (needs HM Rock Smash)";
    case "npc":
      return `NPC (gfx ${String(graphicsId)})`;
  }
}

function describeRelative(dx: number, dy: number): string {
  // Manhattan-style human description. dx>0 east, dy>0 south.
  const parts: string[] = [];
  if (dy < 0) parts.push(`${String(-dy)} tile${-dy === 1 ? "" : "s"} north`);
  if (dy > 0) parts.push(`${String(dy)} tile${dy === 1 ? "" : "s"} south`);
  if (dx < 0) parts.push(`${String(-dx)} tile${-dx === 1 ? "" : "s"} west`);
  if (dx > 0) parts.push(`${String(dx)} tile${dx === 1 ? "" : "s"} east`);
  return parts.join(" + ");
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => {
      if (word.length === 0) return word;
      return `${word[0].toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
}
