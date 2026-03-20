import { z } from "zod";
import runesData from "./assets/runesReforged.json" with { type: "json" };

// Runes are organized by style (tree) with selections
export const RuneTreeSchema = z.array(
  z.object({
    id: z.number(),
    key: z.string(),
    icon: z.string(),
    name: z.string(),
    slots: z.array(
      z.object({
        runes: z.array(
          z.object({
            id: z.number(),
            key: z.string(),
            icon: z.string(),
            name: z.string(),
            shortDesc: z.string(),
            longDesc: z.string(),
          }),
        ),
      }),
    ),
  }),
);

export const runes = RuneTreeSchema.parse(runesData);

export function getRuneInfo(runeId: number):
  | {
      name: string;
      shortDesc: string;
      longDesc: string;
      icon: string;
    }
  | undefined {
  // Flatten and search through all runes
  for (const tree of runes) {
    for (const slot of tree.slots) {
      for (const rune of slot.runes) {
        if (rune.id === runeId) {
          return {
            name: rune.name,
            shortDesc: rune.shortDesc,
            longDesc: rune.longDesc,
            icon: rune.icon,
          };
        }
      }
    }
  }
  return undefined;
}

export function getRuneTreeName(treeId: number): string | undefined {
  const tree = runes.find((t) => t.id === treeId);
  return tree?.name;
}

export function getRuneTreeInfo(treeId: number):
  | {
      name: string;
      icon: string;
    }
  | undefined {
  const tree = runes.find((t) => t.id === treeId);
  if (!tree) {
    return undefined;
  }
  return {
    name: tree.name,
    icon: tree.icon,
  };
}

export function getRuneTreeForRune(runeId: number):
  | {
      treeId: number;
      treeName: string;
      treeIcon: string;
    }
  | undefined {
  for (const tree of runes) {
    for (const slot of tree.slots) {
      for (const rune of slot.runes) {
        if (rune.id === runeId) {
          return {
            treeId: tree.id,
            treeName: tree.name,
            treeIcon: tree.icon,
          };
        }
      }
    }
  }
  return undefined;
}
