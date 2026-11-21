import { useSearchParams } from "react-router";
import { z } from "zod";

/** The query parameter that carries the "Needs attention" filter. */
export const ATTENTION_PARAM = "show";

const AttentionFilterSchema = z.enum(["all", "waiting"]);
export type AttentionFilter = z.infer<typeof AttentionFilterSchema>;

/** Home with the attention panel showing only what waits on Jerred. */
export const WAITING_PATH = `/?${ATTENTION_PARAM}=waiting`;

/** An absent or unrecognised value shows everything. */
export function parseAttentionFilter(value: string | null): AttentionFilter {
  const parsed = AttentionFilterSchema.safeParse(value);
  return parsed.success ? parsed.data : "all";
}

/**
 * The search params for a filter. "All" is the default, so it leaves the
 * parameter out and the plain Home URL stays canonical.
 */
export function withAttentionFilter(
  params: URLSearchParams,
  filter: AttentionFilter,
): URLSearchParams {
  const updated = new URLSearchParams(params);
  if (filter === "all") updated.delete(ATTENTION_PARAM);
  else updated.set(ATTENTION_PARAM, filter);
  return updated;
}

/** The filter lives in the URL so the waiting view can be linked to. */
export function useAttentionFilter(): [
  AttentionFilter,
  (filter: AttentionFilter) => void,
] {
  const [params, setParams] = useSearchParams();
  return [
    parseAttentionFilter(params.get(ATTENTION_PARAM)),
    (next) => {
      setParams(withAttentionFilter(params, next), { replace: true });
    },
  ];
}
