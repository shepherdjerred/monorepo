import type { AppConfig } from "./config.ts";
import { collectHomePayload } from "./collectors/home.ts";
import { collectHomelabPayload } from "./collectors/homelab.ts";
import type { HomePayload, HomelabPayload } from "./types.ts";

export type AppDeps = {
  collectHome?: () => Promise<HomePayload>;
  collectHomelab?: () => Promise<HomelabPayload>;
};

export function createHandler(config: AppConfig, deps: AppDeps = {}) {
  const collectHome = deps.collectHome ?? (() => collectHomePayload(config));
  const collectHomelab =
    deps.collectHomelab ?? (() => collectHomelabPayload(config));

  return async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "GET") {
      return json({ error: "method not allowed" }, 405);
    }

    if (url.pathname === "/livez") {
      return new Response("ok");
    }

    if (url.pathname === "/healthz") {
      return json({ status: "ok" });
    }

    if (!isAuthorized(request, config.trmnlApiKey)) {
      return json({ error: "unauthorized" }, 401);
    }

    if (url.pathname === "/api/home") {
      return json(await collectHome());
    }

    if (url.pathname === "/api/homelab") {
      return json(await collectHomelab());
    }

    return json({ error: "not found" }, 404);
  };
}

function isAuthorized(request: Request, expected: string): boolean {
  const actual = request.headers.get("x-api-key");
  return actual != null && timingSafeEqual(actual, expected);
}

function timingSafeEqual(actual: string, expected: string): boolean {
  const actualBytes = new TextEncoder().encode(actual);
  const expectedBytes = new TextEncoder().encode(expected);
  if (actualBytes.length !== expectedBytes.length) {
    return false;
  }
  let diff = 0;
  for (const [index, byte] of actualBytes.entries()) {
    diff |= byte ^ (expectedBytes[index] ?? 0);
  }
  return diff === 0;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
