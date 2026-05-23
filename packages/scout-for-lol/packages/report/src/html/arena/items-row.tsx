import { palette } from "#src/assets/colors.ts";
import { getItemImage } from "#src/dataDragon/image-cache.ts";

const ITEM_SIZE = 26;

function isPrismaticItem(itemId: number): boolean {
  return itemId.toString().startsWith("44");
}

function ItemSlot({ itemId }: { itemId: number }) {
  if (itemId === 0) {
    return (
      <div
        style={{
          width: ITEM_SIZE,
          height: ITEM_SIZE,
          display: "flex",
          backgroundColor: palette.blue[5],
          border: `1px solid ${palette.gold[6]}`,
        }}
      />
    );
  }

  const prismatic = isPrismaticItem(itemId);
  return (
    <div
      style={{
        width: ITEM_SIZE,
        height: ITEM_SIZE,
        display: "flex",
        position: "relative",
      }}
    >
      <img
        src={getItemImage(itemId)}
        alt=""
        width={ITEM_SIZE}
        height={ITEM_SIZE}
        style={{
          width: ITEM_SIZE,
          height: ITEM_SIZE,
          border: prismatic
            ? `1px solid transparent`
            : `1px solid ${palette.gold[5]}`,
        }}
      />
      {prismatic && (
        <div
          style={{
            position: "absolute",
            top: -2,
            left: -2,
            right: -2,
            bottom: -2,
            display: "block",
            border: `2px solid #8338ec`,
            boxShadow: `0 0 6px rgba(131, 56, 236, 0.7)`,
          }}
        />
      )}
    </div>
  );
}

export function ItemsRow({ items }: { items: number[] }) {
  const slots = items.slice(0, 6);
  const padded: number[] = [
    ...slots,
    ...Array.from({ length: 6 - slots.length }).map((): number => 0),
  ];
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 3 }}>
      {padded.map((id, idx) => (
        <ItemSlot key={idx} itemId={id} />
      ))}
    </div>
  );
}
