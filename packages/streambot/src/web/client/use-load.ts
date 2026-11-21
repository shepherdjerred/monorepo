import { useEffect, useState } from "react";
import type { z } from "zod";
import { apiRequest, type ApiFailure } from "./api.ts";

export type Load<T> =
  | { readonly status: "loading" }
  | { readonly status: "done"; readonly data: T }
  | { readonly status: "failed"; readonly failure: ApiFailure };

/**
 * One GET whose result a section renders. `url === null` skips the request (the section is off or
 * its server is not known yet). A new URL aborts the previous request.
 */
export function useLoad<T>(url: string | null, schema: z.ZodType<T>) {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (url === null) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    const load = async () => {
      const result = await apiRequest(url, schema, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setState(
        result.ok
          ? { status: "done", data: result.data }
          : { status: "failed", failure: result.failure },
      );
    };
    void load();
    return () => {
      controller.abort();
    };
  }, [url, schema, attempt]);
  return {
    state,
    retry: () => {
      setAttempt((value) => value + 1);
    },
  };
}
