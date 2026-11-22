import { useMemo, useSyncExternalStore } from "react";
import { z } from "zod";
import {
  buildPlayersSearchParams,
  buildStaffQuerySearch,
  type PlayersRouteQuery,
  type StaffQueryFilters,
} from "./router.ts";

export function buildPlayersApiUrl(query: PlayersRouteQuery): string {
  return `/api/v1/players?${buildPlayersSearchParams(query, false).toString()}`;
}

export function buildStaffQueryApiUrl(filters: StaffQueryFilters): string {
  return `/api/staff/query${buildStaffQuerySearch(filters)}`;
}

export function buildPlayerApiUrl(id: string): string {
  return `/api/v1/players/${encodeURIComponent(id)}`;
}

export function buildStaffPlayerApiUrl(id: string): string {
  return `/api/staff/players/${encodeURIComponent(id)}`;
}

export function buildStaffPlayerRawUrl(id: string): string {
  return `/api/staff/players/${encodeURIComponent(id)}/raw`;
}

export type ApiQueryState<T> =
  | {
      readonly status: "idle";
      readonly data: undefined;
      readonly error: undefined;
    }
  | {
      readonly status: "pending";
      readonly data: undefined;
      readonly error: undefined;
    }
  | { readonly status: "success"; readonly data: T; readonly error: undefined }
  | {
      readonly status: "error";
      readonly data: undefined;
      readonly error: string;
      readonly httpStatus?: number;
    };

export const QUERY_STALE_TIME_MS = 30_000;
export const QUERY_POLL_INTERVAL_MS = 60_000;

type CacheEntry = {
  state: ApiQueryState<unknown>;
  fetchedAt: number;
  inFlight: Promise<void> | null;
  listeners: Set<() => void>;
  latestSchema: z.ZodType | null;
  stopLiveRefresh: (() => void) | null;
};

const queryCache = new Map<string, CacheEntry>();

export function resetQueryCacheForTests(): void {
  for (const entry of queryCache.values()) {
    entry.stopLiveRefresh?.();
  }
  queryCache.clear();
}

const ErrorEnvelopeSchema = z.object({
  error: z.string(),
});

function extractErrorMessage(body: unknown, status: number): string {
  const parsed = ErrorEnvelopeSchema.safeParse(body);
  if (parsed.success && parsed.data.error.length > 0) {
    return parsed.data.error;
  }
  if (status === 404) {
    return "Requested record was not found.";
  }
  return status === 403 || status === 401
    ? "Access denied for this analytics endpoint."
    : `Request failed (HTTP ${String(status)})`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function getOrCreateEntry(url: string): CacheEntry {
  const existing = queryCache.get(url);
  if (existing !== undefined) {
    return existing;
  }
  const created: CacheEntry = {
    state: { status: "pending", data: undefined, error: undefined },
    fetchedAt: 0,
    inFlight: null,
    listeners: new Set(),
    latestSchema: null,
    stopLiveRefresh: null,
  };
  queryCache.set(url, created);
  return created;
}

function notifyEntry(entry: CacheEntry): void {
  for (const listener of entry.listeners) {
    listener();
  }
}

function isEntryStale(entry: CacheEntry): boolean {
  return (
    entry.state.status !== "success" ||
    Date.now() - entry.fetchedAt >= QUERY_STALE_TIME_MS
  );
}

function attachEntryLiveRefresh(url: string, entry: CacheEntry): void {
  if (entry.stopLiveRefresh !== null) {
    return;
  }
  const revalidateIfVisible = (): void => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return;
    }
    if (
      entry.latestSchema !== null &&
      entry.inFlight === null &&
      isEntryStale(entry)
    ) {
      startFetch(url, entry.latestSchema, false);
    }
  };
  const timer = globalThis.setInterval(
    revalidateIfVisible,
    QUERY_POLL_INTERVAL_MS,
  );
  const hasDocument =
    typeof document !== "undefined" &&
    typeof document.addEventListener === "function";
  if (hasDocument) {
    document.addEventListener("visibilitychange", revalidateIfVisible);
  }
  entry.stopLiveRefresh = () => {
    globalThis.clearInterval(timer);
    if (hasDocument) {
      document.removeEventListener("visibilitychange", revalidateIfVisible);
    }
    entry.stopLiveRefresh = null;
  };
}

function startFetch<T>(
  url: string,
  schema: z.ZodType<T>,
  forceRefetch: boolean,
): void {
  if (typeof globalThis.fetch !== "function") {
    return;
  }
  const entry = getOrCreateEntry(url);
  entry.latestSchema = schema;
  if (entry.inFlight !== null) {
    return;
  }
  if (!forceRefetch && !isEntryStale(entry)) {
    return;
  }

  if (entry.state.status !== "success") {
    entry.state = { status: "pending", data: undefined, error: undefined };
    notifyEntry(entry);
  }

  entry.inFlight = (async () => {
    try {
      const response = await globalThis.fetch(url, {
        headers: { accept: "application/json" },
      });
      const rawBody = await parseResponseBody(response);
      if (!response.ok) {
        entry.state = {
          status: "error",
          data: undefined,
          error: extractErrorMessage(rawBody, response.status),
          httpStatus: response.status,
        };
        return;
      }
      const validated = schema.safeParse(rawBody);
      if (!validated.success) {
        entry.state = {
          status: "error",
          data: undefined,
          error: `Response validation failed: ${validated.error.issues[0]?.message ?? "invalid payload"}`,
        };
        return;
      }
      entry.fetchedAt = Date.now();
      entry.state = {
        status: "success",
        data: validated.data,
        error: undefined,
      };
    } catch (error_: unknown) {
      const parsedErr = z.object({ message: z.string() }).safeParse(error_);
      entry.state = {
        status: "error",
        data: undefined,
        error: parsedErr.success ? parsedErr.data.message : "Network error",
      };
    } finally {
      entry.inFlight = null;
      notifyEntry(entry);
    }
  })();
}

const IDLE_STATE: ApiQueryState<never> = {
  status: "idle",
  data: undefined,
  error: undefined,
};

const PENDING_STATE: ApiQueryState<never> = {
  status: "pending",
  data: undefined,
  error: undefined,
};

export function refetchApiUrl<T>(url: string, schema: z.ZodType<T>): void {
  startFetch(url, schema, true);
}

export function revalidateApiUrlIfStale<T>(
  url: string,
  schema: z.ZodType<T>,
): void {
  startFetch(url, schema, false);
}

export function useApiQuery<T>(
  url: string | null,
  schema: z.ZodType<T>,
): {
  readonly state: ApiQueryState<T>;
  readonly refetch: () => void;
} {
  const rawState = useSyncExternalStore(
    (listener) => {
      if (url === null) {
        return () => {
          // Disabled query requires no subscription
        };
      }
      const entry = getOrCreateEntry(url);
      entry.latestSchema = schema;
      entry.listeners.add(listener);
      attachEntryLiveRefresh(url, entry);
      if (entry.inFlight === null && isEntryStale(entry)) {
        startFetch(url, schema, false);
      }
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) {
          entry.stopLiveRefresh?.();
        }
      };
    },
    () => {
      if (url === null) {
        return IDLE_STATE;
      }
      const entry = getOrCreateEntry(url);
      if (entry.state.status === "pending" && entry.inFlight === null) {
        startFetch(url, schema, false);
      }
      return entry.state;
    },
    () => (url === null ? IDLE_STATE : PENDING_STATE),
  );

  const narrowedState = useMemo(
    () => narrowQueryState(rawState, schema),
    [rawState, schema],
  );

  return {
    state: narrowedState,
    refetch: () => {
      if (url !== null) {
        startFetch(url, schema, true);
      }
    },
  };
}

function narrowQueryState<T>(
  rawState: ApiQueryState<unknown>,
  schema: z.ZodType<T>,
): ApiQueryState<T> {
  switch (rawState.status) {
    case "idle":
      return IDLE_STATE;
    case "pending":
      return PENDING_STATE;
    case "error":
      return rawState;
    case "success": {
      const checked = schema.safeParse(rawState.data);
      if (!checked.success) {
        return {
          status: "error",
          data: undefined,
          error: "Cached payload did not match schema",
        };
      }
      return {
        status: "success",
        data: checked.data,
        error: undefined,
      };
    }
  }
}
