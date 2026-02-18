import { type Augment } from "@scout-for-lol/data";
import { getAugmentIcon } from "@scout-for-lol/report/dataDragon/image-cache.ts";

const augmentIconSize = "2rem";

export function renderAugment(augment: Augment) {
  if (augment.type === "full") {
    // Use iconLarge from augment data (iconSmall exists but we use iconLarge for better quality)
    const iconUrl = augment.iconLarge
      ? getAugmentIcon(augment.iconLarge)
      : null;

    if (iconUrl !== undefined && iconUrl.length > 0) {
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <img
            src={iconUrl}
            alt=""
            style={{
              width: augmentIconSize,
              height: augmentIconSize,
              flexShrink: 0,
              // filter: `drop-shadow(0 0 16px ${rarityColor}) drop-shadow(0 0 8px ${rarityColor})`,
            }}
            width={augmentIconSize}
            height={augmentIconSize}
          />
          <div style={{ display: "contents" }}>{augment.name}</div>
        </div>
      );
    }

    return <div style={{ display: "contents" }}>{augment.name}</div>;
  }
  // For minimal augments (type === "id"), return text as JSX
  return (
    <div
      style={{ display: "contents" }}
    >{`Augment ${augment.id.toString()}`}</div>
  );
}
