import { type Augment } from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import { getAugmentIcon } from "#src/dataDragon/image-cache.ts";

const ICON_SIZE = 22;

export function AugmentRow({ augment }: { augment: Augment }) {
  if (augment.type === "full") {
    const iconUrl = augment.iconLarge
      ? getAugmentIcon(augment.iconLarge)
      : null;

    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontFamily: font.body,
          fontSize: 11,
          color: palette.gold[1],
          minWidth: 0,
        }}
      >
        {iconUrl !== null && iconUrl.length > 0 ? (
          <img
            src={iconUrl}
            alt=""
            width={ICON_SIZE}
            height={ICON_SIZE}
            style={{
              width: ICON_SIZE,
              height: ICON_SIZE,
              border: `1px solid rgba(155, 90, 200, 0.55)`,
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: ICON_SIZE,
              height: ICON_SIZE,
              border: `1px solid ${palette.grey[3]}`,
              display: "flex",
              flexShrink: 0,
            }}
          />
        )}
        <span
          style={{
            display: "flex",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {augment.name}
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontFamily: font.body,
        fontSize: 11,
        color: palette.grey[1],
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: ICON_SIZE,
          height: ICON_SIZE,
          border: `1px solid ${palette.grey[3]}`,
          display: "flex",
          flexShrink: 0,
        }}
      />
      <span style={{ display: "flex" }}>Augment {augment.id.toString()}</span>
    </div>
  );
}
