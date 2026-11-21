import { AsyncLocalStorage } from "node:async_hooks";
import type { SelectionKind } from "@shepherdjerred/streambot/observability/product-analytics.ts";

/**
 * What the web command boundary knows about the request that a play deeper in the stack does
 * not: which kind of selection was chosen. Carried ambiently so `observePlay` can report it
 * without widening the playback command inputs.
 */
const selectionKinds = new AsyncLocalStorage<SelectionKind>();

export function withSelectionKind<T>(kind: SelectionKind, run: () => T): T {
  return selectionKinds.run(kind, run);
}

export function currentSelectionKind(): SelectionKind | undefined {
  return selectionKinds.getStore();
}
