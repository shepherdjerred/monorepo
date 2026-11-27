import { useSearchParams } from "react-router";
import {
  parsePlayerPageFilters,
  playerPageSearchParams,
} from "#src/lib/player/page-filters.ts";
import type { PlayerProfileFilters } from "#src/lib/player/player-profile-filters.ts";

/** The Player page's filters, read from and written to the URL. */
export function usePlayerPageUrlState(): {
  filters: PlayerProfileFilters;
  setFilters: (filters: PlayerProfileFilters) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  return {
    filters: parsePlayerPageFilters(searchParams),
    setFilters(nextFilters) {
      const next = new URLSearchParams(searchParams);
      for (const key of ["games", "queue", "page", "cursor"]) next.delete(key);
      for (const [key, value] of playerPageSearchParams(nextFilters)) {
        next.append(key, value);
      }
      setSearchParams(next, { replace: true });
    },
  };
}
