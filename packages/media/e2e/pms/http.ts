import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { PlexClient } from "#integrations/plex.ts";
import type { FetchTransport } from "#integrations/http.ts";

const ORIGIN = "http://127.0.0.1:32400";
export const ContainerSchema = z.object({
  MediaContainer: z.record(z.string(), z.unknown()),
});

export function createPmsWire(root: string, signal: AbortSignal) {
  const calls: { method: string; path: string; status: number }[] = [];
  const fixtures = new Map<
    string,
    { method: string; path: string; status: number; body: string }
  >();
  const transport: FetchTransport = async (input, init) => {
    const url = new URL(input);
    if (url.origin !== ORIGIN)
      throw new Error("PMS fixture transport escaped owned loopback service");
    if (
      !/^\/(?:identity|media\/providers\/metadata|library\/sections(?:\/all|\/\d+\/(?:all|refresh))?|library\/metadata\/\d+)$/u.test(
        url.pathname,
      )
    )
      throw new Error(
        "PMS fixture requested an endpoint outside its wire whitelist",
      );
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      redirect: "error",
    });
    calls.push({
      method: init.method ?? "GET",
      path: url.pathname,
      status: response.status,
    });
    const body = await response.clone().text();
    if (body.length > 262_144)
      throw new Error("Synthetic PMS response exceeded bounded fixture size");
    // No credentials are configured. Never retain an unexpected credential-bearing response.
    if (/plexOnlineToken|authenticationToken|X-Plex-Token/iu.test(body))
      throw new Error("Unexpected credential-bearing PMS response withheld");
    const key = createHash("sha256")
      .update(`${init.method ?? "GET"}:${url.pathname}:${url.search}`)
      .digest("hex");
    const capture = {
      method: init.method ?? "GET",
      path: url.pathname,
      status: response.status,
      body,
    };
    const proposed = new Map(fixtures).set(key, capture);
    const bytes = [...proposed.values()].reduce(
      (total, value) => total + Buffer.byteLength(JSON.stringify(value)),
      0,
    );
    if (proposed.size > 32 || bytes > 524_288)
      throw new Error(
        "Synthetic wire capture exceeded its exact bounded evidence inventory",
      );
    fixtures.set(key, capture);
    await writeFile(
      path.join(root, "artifacts", `wire-${key}.json`),
      JSON.stringify(capture, null, 2),
    );
    return response;
  };
  const request = async (
    pathname: string,
    parameters: Record<string, string> = {},
    method = "GET",
  ) => {
    const url = new URL(pathname, ORIGIN);
    for (const [key, value] of Object.entries(parameters))
      url.searchParams.set(key, value);
    const response = await transport(url, {
      method,
      headers: {
        Accept: "application/json",
        "X-Plex-Client-Identifier": "media-disposable-wire-fixture",
        "X-Plex-Pms-Api-Version": "1.2.3",
      },
    });
    const body = await response.text();
    if (response.status !== 200)
      throw new Error(
        `PMS ${method} ${url.pathname}: HTTP ${String(response.status)}`,
      );
    return ContainerSchema.parse(JSON.parse(body)).MediaContainer;
  };
  const client = new PlexClient(
    {
      baseUrl: ORIGIN,
      token: "",
      clientIdentifier: "media-disposable-wire-fixture",
    },
    transport,
  );
  return {
    request,
    client,
    calls,
    fixtures,
    libraryReady: () =>
      readPmsLibraryReady(signal, (url, init) => transport(new URL(url), init)),
  };
}
export type PmsWire = ReturnType<typeof createPmsWire>;

/** The identity route can succeed while the library plugin's routes are still unavailable. */
export async function readPmsLibraryReady(
  signal: AbortSignal,
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<true | null> {
  signal.throwIfAborted();
  const response = await request(`${ORIGIN}/library/sections`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
    redirect: "error",
  });
  if (response.status === 404 || response.status === 503) {
    await response.body?.cancel();
    return null;
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(
      `Local unclaimed library API must be accessible without auth bypass: HTTP ${String(response.status)}`,
    );
  }
  ContainerSchema.parse(await response.json());
  return true;
}

/** A starting, unclaimed local PMS can serve HTTP before its identity is ready. */
export async function readPmsBootstrap(
  signal: AbortSignal,
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<true | null> {
  signal.throwIfAborted();
  try {
    const response = await request(`${ORIGIN}/identity`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
      redirect: "error",
    });
    await response.body?.cancel();
    if (response.status === 503) return null;
    if (response.status !== 200)
      throw new Error(
        `Local unclaimed identity must be accessible without auth bypass: HTTP ${String(response.status)}`,
      );
    return true;
  } catch (error) {
    const system = z.object({ code: z.string() }).safeParse(error);
    if (
      system.success &&
      ["ECONNREFUSED", "ConnectionRefused"].includes(system.data.code)
    )
      return null;
    throw error;
  }
}

/** Poll only reads with a fixed deadline; failed mutations are never retried. */
export async function until<T>(
  label: string,
  read: () => Promise<T | null>,
  signal: AbortSignal,
): Promise<T> {
  for (;;) {
    signal.throwIfAborted();
    const value = await read();
    if (value !== null) return value;
    await new Promise<void>((resolve, reject) => {
      const aborted = () => {
        clearTimeout(timer);
        reject(new Error(`${label} deadline expired`));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", aborted);
        resolve();
      }, 500);
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
    });
  }
}
