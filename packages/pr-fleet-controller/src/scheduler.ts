import type { FleetScheduler } from "./ports.ts";

export const defaultFleetScheduler: FleetScheduler = {
  schedule: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return () => {
      clearTimeout(timer);
    };
  },
};
