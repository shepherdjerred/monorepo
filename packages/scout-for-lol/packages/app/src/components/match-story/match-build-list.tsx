import { AssetIcon } from "@scout-for-lol/design-system/domain/rows/asset-icon";
import type { SetupItem } from "@scout-for-lol/design-system/domain/rows/setup-row";

function Item(props: { item: SetupItem; label: string }) {
  return (
    <li className="flex items-center gap-2.5 font-semibold">
      <AssetIcon asset={props.item.asset} label="" />
      <span>{props.label}</span>
    </li>
  );
}

/** "Malignance first", "then Sorcerer's Shoes": the order is in the words. */
function sequenceLabel(item: SetupItem, index: number): string {
  return index === 0 ? `${item.label} first` : `then ${item.label}`;
}

/**
 * One group of the build: a heading over its icons. Ordered items stack as a
 * numbered list, so a narrow column never wraps a separator onto its own line;
 * an unordered group flows as a row.
 */
export function BuildGroup(props: {
  title: string;
  items: readonly SetupItem[];
  ordered?: boolean;
}) {
  const ordered = props.ordered === true;
  const List = ordered ? "ol" : "ul";
  return (
    <div>
      <h3 className="font-display text-base font-bold text-scout-subtle">
        {props.title}
      </h3>
      <List
        className={
          ordered
            ? "mt-2.5 grid list-none gap-2.5 p-0"
            : "mt-2.5 flex list-none flex-wrap gap-x-5 gap-y-2.5 p-0"
        }
      >
        {props.items.map((item, index) => (
          <Item
            key={`${item.asset.kind}-${String(item.asset.key)}-${index.toString()}`}
            item={item}
            label={ordered ? sequenceLabel(item, index) : item.label}
          />
        ))}
      </List>
    </div>
  );
}
