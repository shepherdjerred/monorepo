import { useSearchParams } from "react-router";
import {
  parsePlayerProfileFilters,
  playerProfileSearchParams,
  type PlayerProfileFilters,
} from "#src/lib/player/player-profile-filters.ts";

export function usePlayerProfileUrlState(): {
  filters: PlayerProfileFilters;
  setFilters: (filters: PlayerProfileFilters) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parsePlayerProfileFilters(searchParams);

  return {
    filters,
    setFilters(nextFilters) {
      const next = new URLSearchParams(searchParams);
      next.delete("games");
      next.delete("queue");
      next.delete("page");
      next.delete("cursor");
      for (const [key, value] of playerProfileSearchParams(nextFilters))
        next.append(key, value);
      setSearchParams(next, { replace: true });
    },
  };
}
