// Turns parsed patch notes into the committed `patch-changes` entries: maps
// champion and item names onto the repo's ids and derives each line's
// direction. Unknown names fail loudly; a name the registry cannot place means
// the registry or the parser is wrong, and guessing would ship a wrong link.

import { getChampionIdByName } from "#src/model/riot/champion-registry.ts";
import { items } from "#src/data-dragon/item.ts";
import { directionOfChange } from "#src/data-dragon/patch-changes-direction.ts";
import {
  parsePatchNotes,
  type ParsedPatchNotes,
  type RawPatchChange,
} from "#src/data-dragon/patch-changes-parser.ts";
import {
  PatchAbilitySlotSchema,
  PatchChangesSchema,
  type PatchChangeLine,
  type PatchChangeSubject,
  type PatchChanges,
} from "#src/data-dragon/patch-changes-schema.ts";

function itemKey(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

/**
 * Items whose name in an archived page is not the current catalog name. Each
 * entry is a rename of the same Summoner's Rift item, verified against the
 * catalog at load time.
 */
const RENAMED_ITEMS: Readonly<Record<string, number>> = {
  "Sunfire Cape": 3068, // now "Sunfire Aegis"
};

function buildItemIndex(): Map<string, number> {
  // Only Summoner's Rift items: Arena and Swarm copies share names but are
  // different items. When a name still repeats, the lowest id is the original.
  const index = new Map<string, number>();
  for (const [id, item] of Object.entries(items.data)) {
    if (item.maps["11"] !== true) continue;
    const key = itemKey(item.name);
    const existing = index.get(key);
    if (existing === undefined || Number(id) < existing) {
      index.set(key, Number(id));
    }
  }
  for (const [name, id] of Object.entries(RENAMED_ITEMS)) {
    if (items.data[String(id)]?.maps["11"] !== true) {
      throw new Error(
        `Renamed item ${name} points at missing item ${String(id)}`,
      );
    }
    index.set(itemKey(name), id);
  }
  return index;
}

const itemIndex = buildItemIndex();

/** "World Atlas and Runic Compass" heads one block for two items. */
function resolveItems(name: string): PatchChangeSubject[] {
  const whole = itemIndex.get(itemKey(name));
  if (whole !== undefined) {
    return [{ kind: "item", id: whole, name }];
  }
  const parts = name.split(" and ");
  const resolved = parts.map((part) => ({
    part,
    id: itemIndex.get(itemKey(part)),
  }));
  if (parts.length > 1 && resolved.every((entry) => entry.id !== undefined)) {
    return resolved.flatMap((entry) =>
      entry.id === undefined
        ? []
        : [{ kind: "item" as const, id: entry.id, name: entry.part }],
    );
  }
  throw new Error(`Patch notes item "${name}" is not in the item catalog`);
}

function resolveSubjects(change: RawPatchChange): PatchChangeSubject[] {
  if (change.kind === "item") {
    return resolveItems(change.subject);
  }
  const id = getChampionIdByName(change.subject);
  if (id === undefined) {
    throw new Error(
      `Patch notes champion "${change.subject}" is not in the champion registry`,
    );
  }
  return [{ kind: "champion", id, name: change.subject }];
}

function toLines(
  parsed: ParsedPatchNotes,
  change: RawPatchChange,
): PatchChangeLine[] {
  const ability =
    change.ability === null
      ? null
      : {
          slot:
            change.ability.slot === null
              ? null
              : PatchAbilitySlotSchema.parse(change.ability.slot),
          name: change.ability.name,
        };
  return resolveSubjects(change).map((subject) => ({
    patch: parsed.patch,
    date: parsed.date,
    subject,
    ability,
    stat: change.stat,
    before: change.before,
    after: change.after,
    direction: directionOfChange(change.stat, change.before, change.after),
  }));
}

export function buildPatchChanges(parsed: ParsedPatchNotes): PatchChanges {
  return PatchChangesSchema.parse(
    parsed.changes.flatMap((change) => toLines(parsed, change)),
  );
}

export async function patchChangesFromHtml(
  html: string,
): Promise<PatchChanges> {
  return buildPatchChanges(await parsePatchNotes(html));
}

function patchOrder(patch: string): number {
  const [major = 0, minor = 0] = patch.split(".").map(Number);
  return major * 1000 + minor;
}

/** Newest patch first; page order within a patch (the sort is stable). */
export function mergePatchChanges(
  perPatch: readonly PatchChanges[],
): PatchChanges {
  return perPatch
    .flat()
    .toSorted(
      (left, right) => patchOrder(right.patch) - patchOrder(left.patch),
    );
}
