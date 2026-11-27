import { type PatchChangeLine } from "#src/data-dragon/patch-changes-schema.ts";
import { patchChanges } from "#src/data-dragon/patch-changes.ts";
import type { ChampionId } from "#src/model/core/identifiers.ts";

/**
 * A champion's recent balance changes from the parsed official patch notes, so
 * a tip never describes a value the champion no longer has. "Recent" is the
 * newest {@link RECENT_PATCH_COUNT} patches in the parsed notes.
 */

export const RECENT_PATCH_COUNT = 3;

/** The newest patches in the parsed notes, newest first. */
export function recentPatches(
  lines: readonly PatchChangeLine[] = patchChanges,
  count = RECENT_PATCH_COUNT,
): string[] {
  const dates = new Map<string, string>();
  for (const line of lines) {
    dates.set(line.patch, line.date);
  }
  return [...dates.entries()]
    .toSorted(([, left], [, right]) =>
      left < right ? 1 : left > right ? -1 : 0,
    )
    .slice(0, count)
    .map(([patch]) => patch);
}

/** Every line about the champion in the recent patches, newest patch first. */
export function recentChampionChanges(
  championId: ChampionId,
  lines: readonly PatchChangeLine[] = patchChanges,
): PatchChangeLine[] {
  const patches = recentPatches(lines);
  return lines
    .filter(
      (line) =>
        line.subject.kind === "champion" &&
        line.subject.id === championId &&
        patches.includes(line.patch),
    )
    .toSorted(
      (left, right) =>
        patches.indexOf(left.patch) - patches.indexOf(right.patch),
    );
}

/** One change as a prompt line: `26.23 Orb of Deception (Q), Damage: 40 -> 35`. */
export function describePatchChange(line: PatchChangeLine): string {
  const where =
    line.ability === null
      ? "base stats"
      : line.ability.slot === null
        ? line.ability.name
        : `${line.ability.name} (${line.ability.slot})`;
  return `${line.patch} ${where}, ${line.stat}: ${line.before} -> ${line.after}`;
}
