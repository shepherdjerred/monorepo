// Pure formatter: GameSnapshot → multi-line human-readable text that gets
// inlined into the Codex goal prompt. Kept separate from snapshot.ts so the
// goal-mode prompt can evolve without touching the event-watcher path.

import { BADGES } from "#src/game/events/data/badges.ts";
import { speciesName } from "#src/game/events/generated/species.ts";
import type { GameSnapshot } from "#src/game/events/types.ts";

const NO_SNAPSHOT_MESSAGE =
  "Game state unavailable (no save loaded or mid-relocation).";

export function formatGameStateForPrompt(
  snapshot: GameSnapshot | null,
): string {
  if (snapshot === null) {
    return NO_SNAPSHOT_MESSAGE;
  }

  const lines: string[] = [];
  lines.push(formatPartyLine(snapshot));
  lines.push(formatBadgesLine(snapshot));
  lines.push(formatDexLine(snapshot));
  lines.push(formatLastCatchLine(snapshot));
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
