import { useEffect } from "react";
import type { AnchorAdapter, ViewerProps } from "./types.ts";

/**
 * Publishes a viewer's AnchorAdapter to the stage for as long as it is mounted
 * and tells the stage to reposition pins once it is registered.
 */
export function useAdapterRegistration(
  adapterRef: ViewerProps["adapterRef"],
  adapter: AnchorAdapter,
  onViewChange: () => void,
): void {
  useEffect(() => {
    adapterRef.current = adapter;
    onViewChange();
    return () => {
      adapterRef.current = null;
    };
  }, [adapter, adapterRef, onViewChange]);
}
