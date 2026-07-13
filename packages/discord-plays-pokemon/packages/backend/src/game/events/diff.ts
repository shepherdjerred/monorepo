import type { ParsedPartyMon } from "./pokemon-struct.ts";
import type { GameEvent, GameSnapshot } from "./types.ts";

// A single diff that produces more events than this is almost certainly a save
// reload or a different save file being loaded (badges jumping 0→5, the whole
// party changing identity). Drop the batch rather than spamming the channel.
export const MAX_EVENTS_PER_DIFF = 10;

// Stable identity for a party slot. Personality + OT id uniquely identifies a
// specific Pokémon across reorders, PC deposits/withdrawals, and trades, so we
// never mistake a slot shuffle for a faint or an evolution.
function identity(mon: ParsedPartyMon): string {
  return `${String(mon.personality)}:${String(mon.otId)}`;
}

function aliveCount(party: readonly ParsedPartyMon[]): number {
  return party.filter((mon) => !mon.isEgg && mon.hp > 0).length;
}

function newlyOwnedDex(prev: Uint8Array, next: Uint8Array): number[] {
  const numbers: number[] = [];
  const length = Math.min(prev.length, next.length);
  for (let byteIndex = 0; byteIndex < length; byteIndex++) {
    const nextByte = next[byteIndex];
    const prevByte = prev[byteIndex];
    if (nextByte === undefined || prevByte === undefined) {
      throw new Error(`Dex byte index out of range: ${String(byteIndex)}`);
    }
    const added = nextByte & ~prevByte & 0xff;
    if (added === 0) continue;
    for (let bit = 0; bit < 8; bit++) {
      if ((added >> bit) & 1) {
        numbers.push(byteIndex * 8 + bit + 1); // national dex # is 1-based
      }
    }
  }
  return numbers;
}

/**
 * Compute the events between two consecutive valid snapshots. Pure and
 * edge-triggered: every event corresponds to a state transition, so the same
 * standing condition never fires twice.
 */
export function diffSnapshots(
  prev: GameSnapshot,
  next: GameSnapshot,
): GameEvent[] {
  const events: GameEvent[] = [];

  const prevById = new Map(prev.party.map((mon) => [identity(mon), mon]));

  const whiteout =
    aliveCount(prev.party) > 0 &&
    aliveCount(next.party) === 0 &&
    next.party.length > 0;

  for (const mon of next.party) {
    const before = prevById.get(identity(mon));
    if (before === undefined) continue; // newly added mon: never an event here

    // Faint: HP crossed to zero. Suppressed when the whole party blacked out
    // (a single whiteout event stands in for the individual faints).
    if (!mon.isEgg && before.hp > 0 && mon.hp === 0 && !whiteout) {
      events.push({
        kind: "faint",
        species: mon.species,
        nickname: mon.nickname,
        level: mon.level,
      });
    }

    // Evolution: same Pokémon, different species.
    if (before.species !== mon.species) {
      events.push({
        kind: "evolution",
        fromSpecies: before.species,
        toSpecies: mon.species,
        nickname: mon.nickname,
        level: mon.level,
      });
    }

    // Level up: same Pokémon, higher level (multi-level gains coalesce).
    if (mon.level > before.level) {
      events.push({
        kind: "levelUp",
        species: mon.species,
        nickname: mon.nickname,
        fromLevel: before.level,
        toLevel: mon.level,
      });
    }
  }

  if (whiteout) events.push({ kind: "whiteout" });

  // Badges: each flag flipping 0→1.
  for (let i = 0; i < next.badges.length; i++) {
    if (prev.badges[i] !== true && next.badges[i] === true) {
      events.push({ kind: "badge", badgeIndex: i });
    }
  }

  // Catch: caughtMonSpecies changed to a new nonzero value. Covers both the
  // 0→X case (struct cleared at battle start) and X→Y (two catches with no
  // observed zero between polls).
  if (
    next.caughtMonSpecies !== 0 &&
    next.caughtMonSpecies !== prev.caughtMonSpecies
  ) {
    events.push({
      kind: "catch",
      species: next.caughtMonSpecies,
      shiny: next.caughtMonShiny,
    });
  }

  // New Pokédex entries (also fires on evolving/hatching a new species, which
  // is semantically a new entry).
  for (const nationalDexNumber of newlyOwnedDex(prev.dexOwned, next.dexOwned)) {
    events.push({ kind: "dexEntry", nationalDexNumber });
  }

  return events;
}
