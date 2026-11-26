import {
  createTRPCClient,
  createTRPCUntypedClient,
  httpLink,
} from "@trpc/client";
import { z } from "zod";
import type { AppRouter } from "@shepherdjerred/tracker/contract";

function presentResponse(res: Response) {
  return {
    status: res.status,
    ok: res.ok,
    headers: res.headers,
    json: (): Promise<unknown> => res.json(),
    text: () => res.text(),
    body: null,
  };
}

export function trackerUrl(value: string): string {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Tracker URL must be an HTTP(S) base URL without credentials, query, or fragment",
    );
  return url.toString().replace(/\/$/u, "");
}

/**
 * Forward-compat for actor metadata: an older Tracker server rejects new
 * optional metadata keys with `unrecognized_keys`. Strip exactly the keys
 * the server named from every `actor.metadata` in the payload and retry
 * once, so a newer toolkit never breaks writes against an older server.
 */
const RecordSchema = z.record(z.string(), z.unknown());

function stripKeys(
  value: unknown,
  keys: Set<string>,
): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const result = stripKeys(item, keys);
      changed ||= result.changed;
      return result.value;
    });
    return { value: items, changed };
  }
  const record = RecordSchema.safeParse(value);
  if (!record.success) return { value, changed: false };
  let changed = false;
  const entries = Object.entries(record.data).map(([key, item]) => {
    if (key === "metadata") {
      const meta = RecordSchema.safeParse(item);
      if (meta.success) {
        const kept = Object.entries(meta.data).filter(([k]) => !keys.has(k));
        changed ||= kept.length !== Object.keys(meta.data).length;
        return [key, Object.fromEntries(kept)] as const;
      }
    }
    const result = stripKeys(item, keys);
    changed ||= result.changed;
    return [key, result.value] as const;
  });
  return { value: Object.fromEntries(entries), changed };
}

export function stripRejectedMetadataKeys(
  bodyText: string,
  responseText: string,
): string | null {
  const text = responseText.replaceAll(String.raw`\"`, '"');
  const keysMatch = /"keys":\s*\[([^\]]+)\]/u.exec(text);
  if (keysMatch === null || !text.includes("unrecognized_keys")) return null;
  const rawKeys = keysMatch[1];
  if (rawKeys === undefined) return null;
  const keys = new Set(
    [...rawKeys.matchAll(/"([^"]+)"/gu)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    ),
  );
  if (keys.size === 0) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return null;
  }
  const { value, changed } = stripKeys(payload, keys);
  return changed ? JSON.stringify(value) : null;
}

function options(baseUrl: string, timeoutMs = 30_000) {
  return {
    links: [
      httpLink({
        url: `${trackerUrl(baseUrl)}/trpc`,
        fetch: async (url: string | URL, init) => {
          const send = async (body: RequestInit["body"]) =>
            fetch(url, {
              ...init,
              ...(body === undefined ? {} : { body }),
              signal: AbortSignal.timeout(timeoutMs),
            });
          const response = await send(init?.body ?? undefined);
          if (response.ok || typeof init?.body !== "string")
            return presentResponse(response);
          const retryBody = stripRejectedMetadataKeys(
            init.body,
            await response
              .clone()
              .text()
              .catch(() => ""),
          );
          return retryBody === null
            ? presentResponse(response)
            : presentResponse(await send(retryBody));
        },
      }),
    ],
  };
}

export function trackerClient(baseUrl: string, timeoutMs?: number) {
  return createTRPCClient<AppRouter>(options(baseUrl, timeoutMs));
}
export function trackerApi(baseUrl: string) {
  return createTRPCUntypedClient(options(baseUrl));
}
export type TrackerClient = ReturnType<typeof trackerClient>;
