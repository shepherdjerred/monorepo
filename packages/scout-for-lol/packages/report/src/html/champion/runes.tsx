import { palette } from "@scout-for-lol/report/assets/colors.ts";
import {
  getRuneInfo,
  getRuneTreeForRune,
  type Rune,
} from "@scout-for-lol/data";
import { getRuneIconUrl } from "@scout-for-lol/report/dataDragon/runes.ts";

const keystoneSize = "3.75rem";

// TODO(https://github.com/shepherdjerred/scout-for-lol/issues/184): Consider displaying all primary/secondary runes or stat shards for more detail
export function Runes({ runes }: { runes: Rune[] }) {
  if (runes.length === 0) {
    return null;
  }

  // First rune is the keystone (from primary tree)
  const keystone = runes[0];
  if (!keystone) {
    return null;
  }
  const keystoneInfo = getRuneInfo(keystone.id);

  // Fifth rune (index 4) is the first from secondary tree, use it to get secondary tree icon
  // Ranked games have 6 runes: 4 primary + 2 secondary
  const secondaryRune = runes[4];
  const secondaryTree = secondaryRune
    ? getRuneTreeForRune(secondaryRune.id)
    : undefined;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      {keystoneInfo && (
        <div
          style={{ width: keystoneSize, height: keystoneSize, display: "flex" }}
        >
          <img
            src={getRuneIconUrl(keystoneInfo.icon)}
            alt={keystoneInfo.name}
            style={{
              width: keystoneSize,
              height: keystoneSize,
              borderRadius: "50%",
              backgroundColor: palette.blue[5],
              border: `.1rem solid ${palette.gold.bright}`,
            }}
          />
        </div>
      )}
      {secondaryTree && (
        <div
          style={{ width: keystoneSize, height: keystoneSize, display: "flex" }}
        >
          <img
            src={getRuneIconUrl(secondaryTree.treeIcon)}
            alt={secondaryTree.treeName}
            style={{
              width: keystoneSize,
              height: keystoneSize,
              borderRadius: "50%",
              backgroundColor: palette.blue[6],
              border: `.1rem solid ${palette.gold.bright}`,
            }}
          />
        </div>
      )}
    </div>
  );
}
