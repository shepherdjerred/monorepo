import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef } from "react";
import type { z } from "zod";

import {
  ExperimentErrorSchema,
  ExperimentListSchema,
  ExperimentSchema,
  type Experiment,
} from "@shepherdjerred/experiments/contract";

export type ExperimentView = "all" | "due" | "running" | "drafts" | "decided";

type Mutation = {
  readonly path?: string;
  readonly method: "POST" | "PATCH";
  readonly body: object;
};

export class ExperimentRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  options: RequestInit,
): Promise<z.output<Schema>> {
  const response = await fetch(url, options).catch((error: unknown) => {
    if (options.signal?.aborted === true) throw error;
    throw new ExperimentRequestError(
      "Could not reach Experiments. Try again.",
      503,
    );
  });
  if (!response.ok) {
    const parsed = ExperimentErrorSchema.safeParse(
      await response.json().catch(() => null),
    );
    const message = parsed.success
      ? parsed.data.error
      : "Experiments is unavailable.";
    throw new ExperimentRequestError(message, response.status);
  }
  return schema.parse(await response.json());
}

export function experimentListQuery(
  api: string,
  view: ExperimentView,
  search: string,
) {
  const query = new URLSearchParams({ view });
  if (search !== "") query.set("q", search);
  return queryOptions({
    queryKey: ["experiments", api, "list", view, search] as const,
    queryFn: ({ signal }) =>
      request(`${api}?${query.toString()}`, ExperimentListSchema, { signal }),
    retry: false,
  });
}

function detailKey(api: string, id: string) {
  return ["experiments", api, "detail", id] as const;
}

export function experimentDetailQuery(api: string, id: string) {
  return queryOptions({
    queryKey: detailKey(api, id),
    queryFn: ({ signal }) =>
      request(`${api}/${encodeURIComponent(id)}`, ExperimentSchema, { signal }),
    retry: false,
  });
}

export function useExperimentMutation(api: string) {
  const queryClient = useQueryClient();
  const attempt = useRef<{ key: string; requestId: string } | undefined>(
    undefined,
  );
  return useMutation({
    mutationFn: ({ path = "", method, body }: Mutation) => {
      const key = JSON.stringify([path, method, body]);
      if (attempt.current?.key !== key) {
        attempt.current = { key, requestId: crypto.randomUUID() };
      }
      return request(api + path, ExperimentSchema, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, requestId: attempt.current.requestId }),
      });
    },
    onSuccess: (record) => {
      attempt.current = undefined;
      queryClient.setQueryData<Experiment>(
        detailKey(api, record.id),
        (latest) =>
          latest !== undefined && latest.revision > record.revision
            ? latest
            : record,
      );
      void queryClient.invalidateQueries({
        queryKey: ["experiments", api, "list"],
      });
    },
    onError: (error) => {
      if (error instanceof ExperimentRequestError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: ["experiments", api] });
      }
    },
  });
}
