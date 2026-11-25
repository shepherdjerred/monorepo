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

const ErrorBodySchema = z.object({ error: z.string() });

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text.length === 0 ? undefined : (JSON.parse(text) as unknown);
}

function errorMessage(body: unknown, status: number): string {
  const parsed = ErrorBodySchema.safeParse(body);
  return parsed.success
    ? parsed.data.error
    : `Request failed (${String(status)})`;
}

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(path);
  const body = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  return schema.parse(body);
}

async function sendJson(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  payload?: unknown,
): Promise<unknown> {
  const response = await fetch(
    path,
    payload === undefined
      ? { method }
      : {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
  );
  const body = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  return body;
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
    queryFn: () => getJson("/api/v1/summary", SummaryResponseSchema),
  });
}

export function useFeedsList(enabled = true) {
  return useQuery({
    queryKey: ["feeds"],
    enabled,
    queryFn: () => getJson("/api/v1/feeds", FeedsListResponseSchema),
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
      getJson(
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
      await sendJson("/api/v1/entries/state", "POST", input);
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
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
      void queryClient.invalidateQueries({ queryKey: ["entries"] });
      void queryClient.invalidateQueries({ queryKey: ["feeds"] });
    },
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: MarkAllReadBody) => {
      await sendJson("/api/v1/entries/mark-all-read", "POST", input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
      void queryClient.invalidateQueries({ queryKey: ["entries"] });
      void queryClient.invalidateQueries({ queryKey: ["feeds"] });
    },
  });
}

export function useRefreshFeeds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<PollRunSummary | undefined> => {
      const body = await sendJson("/api/v1/refresh", "POST");
      const parsed = PollRunSummarySchema.safeParse(body);
      return parsed.success ? parsed.data : undefined;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
      void queryClient.invalidateQueries({ queryKey: ["entries"] });
      void queryClient.invalidateQueries({ queryKey: ["feeds"] });
    },
  });
}

export function useCreateUserFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateUserFeedBody) => {
      await sendJson("/api/v1/feeds", "POST", input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["feeds"] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
      void queryClient.invalidateQueries({ queryKey: ["entries"] });
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
      await sendJson(
        `/api/v1/feeds/${encodeURIComponent(String(input.id))}`,
        "PATCH",
        input.body,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["feeds"] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
      void queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });
}

export function useDeleteUserFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await sendJson(
        `/api/v1/feeds/${encodeURIComponent(String(id))}`,
        "DELETE",
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["feeds"] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
      void queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });
}
