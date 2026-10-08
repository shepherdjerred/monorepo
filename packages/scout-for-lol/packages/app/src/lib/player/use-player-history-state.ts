import { RiotMatchIdSchema } from "@scout-for-lol/data";
import { useSearchParams } from "react-router";
import { z } from "zod";
import type { HistoryCursor } from "#src/components/player/recorded-match-history.tsx";

const Cursors = z.array(
  z.object({
    gameCreationMs: z.number().int(),
    matchId: RiotMatchIdSchema,
    consumed: z.number().int().nonnegative().optional(),
  }),
);

export function readCursors(value: string | null): HistoryCursor[] {
  if (value === null) return [];
  try {
    const parsed = Cursors.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function usePlayerHistoryState() {
  const [params, setParams] = useSearchParams();
  const cursors = readCursors(params.get("cursor"));
  const page = cursors.length;
  return {
    page,
    cursor: cursors.at(-1),
    championSearch: params.get("champion") ?? "",
    setChampionSearch: (value: string) => {
      const next = new URLSearchParams(params);
      next.delete("cursor");
      if (value.length === 0) next.delete("champion");
      else next.set("champion", value);
      setParams(next, { replace: true });
    },
    previous: () => {
      const next = new URLSearchParams(params);
      if (page <= 1) next.delete("cursor");
      else next.set("cursor", JSON.stringify(cursors.slice(0, -1)));
      setParams(next, { replace: true });
    },
    next: (cursor: HistoryCursor) => {
      const next = new URLSearchParams(params);
      next.set("cursor", JSON.stringify([...cursors, cursor]));
      setParams(next, { replace: true });
    },
  };
}
