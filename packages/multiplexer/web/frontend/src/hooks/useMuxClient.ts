import { useMemo } from "react";
import { MuxClient } from "@mux/client";

/**
 * Hook to get a configured MuxClient instance
 */
export function useMuxClient() {
  return useMemo(() => new MuxClient(), []);
}
