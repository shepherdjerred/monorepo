import { useEffect } from "react";
import { addSSEListener } from "@/lib/sse";

export function useSSE(
  eventType: string,
  callback: (data: unknown) => void,
): void {
  useEffect(() => {
    return addSSEListener(eventType, callback);
  }, [eventType, callback]);
}
