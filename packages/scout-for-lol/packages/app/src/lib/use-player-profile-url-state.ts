import { useEffect } from "react";
import { useSearchParams } from "react-router";
import {
  parsePlayerProfileFilters,
  playerProfileSearchParams,
  type PlayerProfileFilters,
} from "#src/lib/player-profile-filters.ts";

export function usePlayerProfileUrlState(): {
  filters: PlayerProfileFilters;
  setFilters: (filters: PlayerProfileFilters) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parsePlayerProfileFilters(searchParams);
  const canonical = playerProfileSearchParams(filters).toString();

  useEffect(() => {
    if (searchParams.toString() === canonical) return;
    setSearchParams(canonical, { replace: true });
  }, [canonical, searchParams, setSearchParams]);

  return {
    filters,
    setFilters(nextFilters) {
      setSearchParams(playerProfileSearchParams(nextFilters), {
        replace: true,
      });
    },
  };
}
