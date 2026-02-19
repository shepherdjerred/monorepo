import { palette } from "@scout-for-lol/report/assets/colors.ts";
import { getItemImage } from "@scout-for-lol/report/dataDragon/image-cache.ts";
import { map } from "remeda";

const dimension = "7.5rem";

function isPrismaticItem(itemId: number): boolean {
  // Prismatic items in Arena have IDs starting with 44
  return itemId.toString().startsWith("44");
}

function getItemIconUrl(itemId: number): string {
  // All items (including prismatic) use cached base64 images
  return getItemImage(itemId);
}

function renderItem(item: number) {
  if (item === 0) {
    return (
      <div
        style={{
          width: dimension,
          height: dimension,
          display: "flex",
          backgroundColor: palette.blue[5],
          border: `.01rem solid ${palette.gold.bright}`,
        }}
      />
    );
  } else {
    const isPrismatic = isPrismaticItem(item);
    const iconUrl = getItemIconUrl(item);
    return (
      <div
        style={{
          width: dimension,
          height: dimension,
          display: "flex",
          position: "relative",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img
          src={iconUrl}
          alt=""
          style={{
            backgroundColor: palette.blue[5],
            border: isPrismatic
              ? `.15rem solid transparent`
              : `.01rem solid ${palette.gold.bright}`,
            width: "100%",
            height: "100%",
            position: "absolute",
            top: 0,
            left: 0,
          }}
          width={"100%"}
          height={"100%"}
        />
        {isPrismatic && (
          <div
            style={{
              display: "block",
              position: "absolute",
              top: "-.15rem",
              left: "-.15rem",
              right: "-.15rem",
              bottom: "-.15rem",
              border: `.2rem solid #8338ec`,
              borderRadius: `.25rem`,
              pointerEvents: "none",
              boxShadow: `0 0 .6rem rgba(131, 56, 236, 0.9)`,
            }}
          />
        )}
      </div>
    );
  }
}

export function renderItems(
  items: number[],
  visionScore: number,
  isArena = false,
) {
  if (isArena) {
    // Arena: render up to 6 items, padding with empty slots
    const itemsToRender = items.slice(0, 6);
    const paddedItems: number[] = [
      ...itemsToRender,
      ...new Array<number>(6 - itemsToRender.length).fill(0),
    ];
    const renderedItems = map(paddedItems, renderItem);

    return <div style={{ display: "flex", gap: "1rem" }}>{renderedItems}</div>;
  } else {
    // Normal game: first 6 slots are regular items, 7th slot is vision item
    const regularItems = items.slice(0, 6);
    const visionItem = items[6]; // 7th item (index 6) is always the vision ward slot

    // Pad regular items to always show 6 slots
    const paddedRegularItems: number[] = [
      ...regularItems,
      ...new Array<number>(6 - regularItems.length).fill(0),
    ];
    const renderedRegularItems = map(paddedRegularItems, renderItem);

    // Vision item slot
    const renderedVisionItem =
      visionItem === undefined ? (
        // Empty vision slot
        <div
          style={{
            display: "flex",
            position: "relative",
            width: dimension,
            height: dimension,
          }}
        >
          {renderItem(0)}
          <span
            style={{
              position: "absolute",
              color: palette.white[1],
              textShadow: "8px 8px #000",
              bottom: "-10px",
              right: "5px",
              fontWeight: 700,
              stroke: "#000",
              strokeWidth: "100px",
            }}
          >
            {visionScore}
          </span>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            position: "relative",
            width: dimension,
            height: dimension,
          }}
        >
          {renderItem(visionItem)}
          <span
            style={{
              position: "absolute",
              color: palette.white[1],
              textShadow: "8px 8px #000",
              bottom: "-10px",
              right: "5px",
              fontWeight: 700,
              stroke: "#000",
              strokeWidth: "100px",
            }}
          >
            {visionScore}
          </span>
        </div>
      );

    return (
      <div style={{ display: "flex", gap: "1rem" }}>
        {renderedRegularItems}
        {renderedVisionItem}
      </div>
    );
  }
}
