import { useSearchParams } from "react-router";

import { SeriesRangeSchema, type SeriesRange } from "#shared/ops-schema";

/** The chart range lives in the URL so a view can be bookmarked. */
export function useRange(
  fallback: SeriesRange,
): [SeriesRange, (range: SeriesRange) => void] {
  const [params, setParams] = useSearchParams();
  const parsed = SeriesRangeSchema.safeParse(params.get("range"));
  const range = parsed.success ? parsed.data : fallback;
  return [
    range,
    (next) => {
      const updated = new URLSearchParams(params);
      updated.set("range", next);
      setParams(updated, { replace: true });
    },
  ];
}
