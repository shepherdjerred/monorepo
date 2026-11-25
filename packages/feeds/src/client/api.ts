import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { z } from "zod";
import {
  EntriesResponseSchema,
  FeedsListResponseSchema,
  PollRunSummarySchema,
  SummaryResponseSchema,
  type CreateUserFeedBody,
  type EntriesResponse,
  type EntryView,
  type MarkAllReadBody,
  type PollRunSummary,
  type UpdateEntriesStateBody,
  type UpdateUserFeedBody,
} from "@shepherdjerred/feeds/shared/contract.ts";

export type EntriesFilter = {
  readonly view: EntryView;
  readonly category?: string | undefined;
  readonly feedId?: number | undefined;
  readonly q?: string | undefined;
};

const ApiErrorEnvelopeSchema = z.object({ error: z.string() });

async function fetchFeedsApi(
  endpoint: string,
  options?: {
    readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
    readonly jsonBody?: unknown;
  },
): Promise<unknown> {
  const method = options?.method ?? "GET";
  const hasJson = options?.jsonBody !== undefined;
  const response = await fetch(endpoint, {
    method,
    ...(hasJson
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(options.jsonBody),
        }
      : {}),
  });
  const rawText = await response.text();
  const decoded =
    rawText.length === 0 ? undefined : (JSON.parse(rawText) as unknown);
  if (!response.ok) {
    const errEnvelope = ApiErrorEnvelopeSchema.safeParse(decoded);
    throw new Error(
      errEnvelope.success
        ? errEnvelope.data.error
        : `Request failed (${String(response.status)})`,
    );
  }
  return decoded;
}

async function fetchParsedFeedsApi<T>(
  endpoint: string,
  schema: z.ZodType<T>,
): Promise<T> {
  return schema.parse(await fetchFeedsApi(endpoint));
}

function invalidateFeedsConsoleQueries(
  queryClient: ReturnType<typeof useQueryClient>,
): void {
  for (const key of ["summary", "entries", "feeds"] as const) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

function entriesQueryPath(
  filter: EntriesFilter,
  cursor: number | undefined,
): string {
  const params = new URLSearchParams({ view: filter.view });
  if (filter.category !== undefined) params.set("category", filter.category);
  if (filter.feedId !== undefined) params.set("feedId", String(filter.feedId));
  const trimmedQuery = filter.q?.trim();
  if (trimmedQuery !== undefined && trimmedQuery.length > 0) {
    params.set("q", trimmedQuery);
  }
  if (cursor !== undefined) params.set("cursor", String(cursor));
  return `/api/v1/entries?${params.toString()}`;
}

export function useSummary() {
  return useQuery({
    queryKey: ["summary"],
    queryFn: () =>
      fetchParsedFeedsApi("/api/v1/summary", SummaryResponseSchema),
  });
}

export function useFeedsList(enabled = true) {
  return useQuery({
    queryKey: ["feeds"],
    enabled,
    queryFn: () =>
      fetchParsedFeedsApi("/api/v1/feeds", FeedsListResponseSchema),
  });
}

export function useEntries(filter: EntriesFilter, enabled = true) {
  return useInfiniteQuery<
    EntriesResponse,
    Error,
    InfiniteData<EntriesResponse, number | null>,
    readonly (string | number | null)[],
    number | null
  >({
    queryKey: [
      "entries",
      filter.view,
      filter.category ?? null,
      filter.feedId ?? null,
      filter.q?.trim() ?? "",
    ],
    enabled,
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      fetchParsedFeedsApi(
        entriesQueryPath(filter, pageParam ?? undefined),
        EntriesResponseSchema,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useUpdateEntriesState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateEntriesStateBody) => {
      await fetchFeedsApi("/api/v1/entries/state", {
        method: "POST",
        jsonBody: input,
      });
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["entries"] });
      const idSet = new Set(input.ids);
      queryClient.setQueriesData<InfiniteData<EntriesResponse>>(
        { queryKey: ["entries"] },
        (existing) => {
          if (existing === undefined) return existing;
          return {
            ...existing,
            pages: existing.pages.map((page) => ({
              ...page,
              items: page.items.map((item) =>
                idSet.has(item.id)
                  ? {
                      ...item,
                      isRead: input.isRead ?? item.isRead,
                      isStarred: input.isStarred ?? item.isStarred,
                    }
                  : item,
              ),
            })),
          };
        },
      );
    },
    onSettled: () => {
      invalidateFeedsConsoleQueries(queryClient);
    },
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: MarkAllReadBody) => {
      await fetchFeedsApi("/api/v1/entries/mark-all-read", {
        method: "POST",
        jsonBody: input,
      });
    },
    onSuccess: () => {
      invalidateFeedsConsoleQueries(queryClient);
    },
  });
}

export function useRefreshFeeds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<PollRunSummary | undefined> => {
      const body = await fetchFeedsApi("/api/v1/refresh", { method: "POST" });
      const parsed = PollRunSummarySchema.safeParse(body);
      return parsed.success ? parsed.data : undefined;
    },
    onSuccess: () => {
      invalidateFeedsConsoleQueries(queryClient);
    },
  });
}

export function useCreateUserFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateUserFeedBody) => {
      await fetchFeedsApi("/api/v1/feeds", { method: "POST", jsonBody: input });
    },
    onSuccess: () => {
      invalidateFeedsConsoleQueries(queryClient);
    },
  });
}

export function useUpdateUserFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly id: number;
      readonly body: UpdateUserFeedBody;
    }) => {
      await fetchFeedsApi(
        `/api/v1/feeds/${encodeURIComponent(String(input.id))}`,
        { method: "PATCH", jsonBody: input.body },
      );
    },
    onSuccess: () => {
      invalidateFeedsConsoleQueries(queryClient);
    },
  });
}

export function useDeleteUserFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await fetchFeedsApi(`/api/v1/feeds/${encodeURIComponent(String(id))}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      invalidateFeedsConsoleQueries(queryClient);
    },
  });
}
