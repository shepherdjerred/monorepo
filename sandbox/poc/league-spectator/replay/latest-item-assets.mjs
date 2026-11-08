import { sha256 } from "./structural-comparison.mjs";
export const ITEM_ASSETS_SHA =
  "89f3a76650cabb2d8719edb74b052c9623f11d543479cd69f4240fcf776afc99";
export async function createLatestItemAssets(report, bytes) {
  if ((await sha256(bytes)) !== ITEM_ASSETS_SHA)
    throw Error("Pinned installed item assets required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "installed-item-presentation" ||
    meta.build !== report.build ||
    meta.protocol !== report.protocol
  )
    throw Error("Item assets and replay differ");
  return {
    metadata: structuredClone(meta),
    get(id) {
      const item = meta.items[id];
      if (!item || item.id !== id) throw Error(`Unprepared item ${id}`);
      return structuredClone(item);
    },
  };
}
