import {
  AdminMessageDetailSchema,
  AdminMessagesResponseSchema,
  AdminOverviewResponseSchema,
  AdminRetryResponseSchema,
  type AdminMessageDetail,
  type AdminMessagesResponse,
  type AdminOverviewResponse,
  type AdminRetryResponse,
} from "@shepherdjerred/mail/shared/contract.ts";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { z } from "zod";

import type { OutboxFilter } from "./format.ts";

const ApiErrorBodySchema = z.object({
  error: z.string().min(1),
});

export class MailApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MailApiError";
    this.status = status;
  }
}

export const mailKeys = {
  all: ["admin"] as const,
  overview: () => ["admin", "overview"] as const,
  messagesAll: () => ["admin", "messages"] as const,
  messages: (filter: OutboxFilter) =>
    [
      "admin",
      "messages",
      {
        status: filter.status ?? null,
        client: filter.client ?? null,
        q: filter.q ?? null,
      },
    ] as const,
  message: (id: string) => ["admin", "message", id] as const,
};

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function formatErrorMessage(body: unknown, status: number): string {
  const parsed = ApiErrorBodySchema.safeParse(body);
  return parsed.success
    ? parsed.data.error
    : `Request failed (${String(status)})`;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

async function requestJson<T>(options: {
  readonly url: string;
  readonly schema: z.ZodType<T>;
  readonly init?: RequestInit;
  readonly fetchImpl?: FetchLike;
}): Promise<T> {
  const fetcher: FetchLike = options.fetchImpl ?? globalThis.fetch;
  const response = await fetcher(options.url, options.init);
  const body = await parseJsonResponse(response);
  if (!response.ok) {
    throw new MailApiError(
      formatErrorMessage(body, response.status),
      response.status,
    );
  }
  return options.schema.parse(body);
}

export function buildAdminMessagesUrl(filter: OutboxFilter): string {
  const params = new URLSearchParams();
  if (filter.status !== undefined) {
    params.set("status", filter.status);
  }
  if (filter.client !== undefined && filter.client.length > 0) {
    params.set("clientId", filter.client);
  }
  if (filter.q !== undefined && filter.q.trim().length > 0) {
    params.set("q", filter.q.trim());
  }
  const search = params.toString();
  return search.length === 0
    ? "/api/admin/messages"
    : `/api/admin/messages?${search}`;
}

export async function fetchAdminOverview(options?: {
  readonly signal?: AbortSignal;
  readonly fetchImpl?: FetchLike;
}): Promise<AdminOverviewResponse> {
  return requestJson({
    url: "/api/admin/overview",
    schema: AdminOverviewResponseSchema,
    ...(options?.signal === undefined
      ? {}
      : { init: { signal: options.signal } }),
    ...(options?.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
}

export async function fetchAdminMessages(
  filter: OutboxFilter,
  options?: {
    readonly signal?: AbortSignal;
    readonly fetchImpl?: FetchLike;
  },
): Promise<AdminMessagesResponse> {
  return requestJson({
    url: buildAdminMessagesUrl(filter),
    schema: AdminMessagesResponseSchema,
    ...(options?.signal === undefined
      ? {}
      : { init: { signal: options.signal } }),
    ...(options?.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
}

export async function fetchAdminMessageDetail(
  id: string,
  options?: {
    readonly signal?: AbortSignal;
    readonly fetchImpl?: FetchLike;
  },
): Promise<AdminMessageDetail> {
  return requestJson({
    url: `/api/admin/messages/${encodeURIComponent(id)}`,
    schema: AdminMessageDetailSchema,
    ...(options?.signal === undefined
      ? {}
      : { init: { signal: options.signal } }),
    ...(options?.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
}

export async function postRetryMessage(
  id: string,
  options?: {
    readonly fetchImpl?: FetchLike;
  },
): Promise<AdminRetryResponse> {
  return requestJson({
    url: `/api/admin/messages/${encodeURIComponent(id)}/retry`,
    schema: AdminRetryResponseSchema,
    init: { method: "POST" },
    ...(options?.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
}

export async function applyRetryMutationResult(
  queryClient: QueryClient,
  id: string,
  result: AdminRetryResponse,
): Promise<void> {
  queryClient.setQueryData(mailKeys.message(id), result.message);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: mailKeys.message(id) }),
    queryClient.invalidateQueries({ queryKey: mailKeys.messagesAll() }),
    queryClient.invalidateQueries({ queryKey: mailKeys.overview() }),
  ]);
}

export function useAdminOverview() {
  return useQuery({
    queryKey: mailKeys.overview(),
    queryFn: ({ signal }) => fetchAdminOverview({ signal }),
    refetchInterval: 15_000,
  });
}

export function useAdminMessages(filter: OutboxFilter) {
  return useQuery({
    queryKey: mailKeys.messages(filter),
    queryFn: ({ signal }) => fetchAdminMessages(filter, { signal }),
    refetchInterval: 15_000,
  });
}

export function useAdminMessageDetail(id: string) {
  return useQuery({
    queryKey: mailKeys.message(id),
    queryFn: ({ signal }) => fetchAdminMessageDetail(id, { signal }),
    enabled: id.length > 0,
  });
}

export function useRetryMessageMutation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postRetryMessage(id),
    onSuccess: async (result) => {
      await applyRetryMutationResult(queryClient, id, result);
    },
  });
}
