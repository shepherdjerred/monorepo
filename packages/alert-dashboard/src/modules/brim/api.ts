import { queryOptions } from "@tanstack/react-query";
import type { z } from "zod";

import { fetchReportsJson } from "#client/reports/reports-api.ts";

export function brimQuery<T extends z.ZodType>(
  path: string,
  schema: T,
  refetchInterval?: number,
) {
  return queryOptions({
    queryKey: ["brim", path],
    queryFn: ({ signal }) =>
      fetchReportsJson(`/api/brim/v1/${path}`, schema, signal),
    retry: false,
    ...(refetchInterval === undefined ? {} : { refetchInterval }),
  });
}
