import { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: false },
    mutations: { retry: false },
  },
});

const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function readApi<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
  });
  return parseResponse(response, schema);
}

export async function parseResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!response.ok) {
    const failure = ErrorResponseSchema.safeParse(await response.json());
    if (!failure.success)
      throw new ApiError(
        "invalid_response",
        "The server returned an unreadable response. Please retry.",
        response.status,
      );
    throw new ApiError(
      failure.data.error.code,
      failure.data.error.message,
      response.status,
    );
  }
  return schema.parse(await response.json());
}

type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const transientCommands = new Map<string, string>();
const transientStorage: StoragePort = {
  getItem: (key) => transientCommands.get(key) ?? null,
  setItem: (key, value) => {
    transientCommands.set(key, value);
  },
  removeItem: (key) => {
    transientCommands.delete(key);
  },
};

/** Retain a command's key until an acknowledged success, including across reloads. */
export async function commandKey(
  storage: StoragePort,
  actorId: string,
  path: string,
  body: unknown,
): Promise<{ storageKey: string; key: string }> {
  const identity = new TextEncoder().encode(
    JSON.stringify({ actorId, path, body }),
  );
  const digest = await crypto.subtle.digest("SHA-256", identity);
  const fingerprint = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const storageKey = `media.command.${fingerprint}`;
  const previous = storage.getItem(storageKey);
  if (previous !== null) return { storageKey, key: previous };
  const key = crypto.randomUUID();
  storage.setItem(storageKey, key);
  return { storageKey, key };
}

function csrfToken(): string {
  const entry = document.cookie
    .split("; ")
    .find(
      (item) =>
        item.startsWith("__Host-media-csrf=") || item.startsWith("media-csrf="),
    );
  if (entry === undefined)
    throw new ApiError(
      "csrf_missing",
      "Your session needs to be refreshed. Reload and sign in again.",
      401,
    );
  return decodeURIComponent(entry.slice(entry.indexOf("=") + 1));
}

export async function writeApi<T>(input: {
  actorId: string;
  path: string;
  body: unknown;
  schema: z.ZodType<T>;
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  /** Secret-bearing forms retain retry identity only in memory, never browser storage. */
  sensitive?: boolean;
}): Promise<T> {
  const storage = input.sensitive === true ? transientStorage : sessionStorage;
  const command = await commandKey(
    storage,
    input.actorId,
    input.path,
    input.body,
  );
  const response = await fetch(`/api/v1${input.path}`, {
    method: input.method ?? "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken(),
      "Idempotency-Key": command.key,
    },
    body: JSON.stringify(input.body),
  });
  const result = await parseResponse(response, input.schema);
  storage.removeItem(command.storageKey);
  return result;
}

export async function authPost<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(`/api/v1/auth${path}`, {
    method: "POST",
    credentials: "same-origin",
  });
  return parseResponse(response, schema);
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/v1/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-CSRF-Token": csrfToken() },
  });
  if (!response.ok)
    throw new ApiError(
      "logout_failed",
      "Could not sign out. Please retry.",
      response.status,
    );
  queryClient.clear();
}
