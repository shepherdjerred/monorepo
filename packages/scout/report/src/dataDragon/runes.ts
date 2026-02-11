import { runes as importedRunes, getRuneIconBase64 } from "@shepherdjerred/scout-data";

// Cache rune icons as base64 data URIs at module load time
const runeIconCache = new Map<string, string>();

// Pre-load all rune icons as base64
if (typeof Bun !== "undefined") {
  const allRuneIcons: string[] = [];
  for (const tree of importedRunes) {
    allRuneIcons.push(tree.icon);
    for (const slot of tree.slots) {
      for (const rune of slot.runes) {
        allRuneIcons.push(rune.icon);
      }
    }
  }

  // Load all rune icons as base64 in parallel
  await Promise.all(
    allRuneIcons.map(async (iconPath) => {
      const base64 = await getRuneIconBase64(iconPath);
      runeIconCache.set(iconPath, base64);
    }),
  );
}

export function getRuneIconUrl(iconPath: string): string {
  const cached = runeIconCache.get(iconPath);
  if (cached) {
    return cached;
  }
  throw new Error(`Rune icon ${iconPath} not found in cache. This should not happen.`);
}
