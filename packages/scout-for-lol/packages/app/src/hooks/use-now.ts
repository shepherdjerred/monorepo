import { useEffect, useState } from "react";

/**
 * A ticking wall-clock timestamp for countdown rendering.
 *
 * The interval only runs while a consumer is mounted, and the countdown it
 * drives is cosmetic — the server remains the authority on whether a betting
 * window is actually open.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
