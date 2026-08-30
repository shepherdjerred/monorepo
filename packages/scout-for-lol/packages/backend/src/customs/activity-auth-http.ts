import { z } from "zod";
import configuration from "#src/configuration.ts";
import {
  CustomAuthHttpError,
  exchangeCustomActivityAuth,
  isAllowedCustomActivityOrigin,
  refreshCustomActivityAuth,
} from "#src/customs/activity-auth.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("customs-activity-auth-http");

function activityCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  return origin !== null && isAllowedCustomActivityOrigin(origin)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        Vary: "Origin",
      }
    : {};
}

function customsAuthRoute(pathname: string) {
  return {
    config: pathname === "/api/customs/config",
    exchange: pathname === "/api/customs/auth/exchange",
    refresh: pathname === "/api/customs/auth/refresh",
  };
}

async function parseRequestBody(
  request: Request,
  headers: Record<string, string>,
): Promise<{ body: unknown } | { response: Response }> {
  try {
    return { body: await request.json() };
  } catch {
    return {
      response: Response.json(
        { error: "Request body must be valid JSON" },
        { status: 400, headers },
      ),
    };
  }
}

async function authenticate(
  exchange: boolean,
  body: unknown,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const response = exchange
      ? await exchangeCustomActivityAuth(body)
      : await refreshCustomActivityAuth(body);
    return Response.json(response, { headers });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Request does not match the Activity contract" },
        { status: 400, headers },
      );
    }
    if (error instanceof CustomAuthHttpError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    }
    logger.error("Custom Activity authentication failed", { error });
    return Response.json(
      { error: "Activity authentication failed" },
      { status: 500, headers },
    );
  }
}

export async function handleCustomAuthRoutes(
  request: Request,
  url: URL,
): Promise<Response | null> {
  const route = customsAuthRoute(url.pathname);
  if (!route.config && !route.exchange && !route.refresh) return null;
  const headers = activityCorsHeaders(request);
  if (route.config && request.method === "GET") {
    if (configuration.environment === "prod") {
      return new Response("Not Found", { status: 404, headers });
    }
    return Response.json(
      {
        applicationId: configuration.applicationId,
        contractHash: configuration.contractHash,
      },
      { headers },
    );
  }
  if (!isAllowedCustomActivityOrigin(request.headers.get("Origin"))) {
    return new Response("Forbidden Activity origin", { status: 403 });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (route.config || request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers });
  }
  const parsed = await parseRequestBody(request, headers);
  if ("response" in parsed) return parsed.response;
  return authenticate(route.exchange, parsed.body, headers);
}
