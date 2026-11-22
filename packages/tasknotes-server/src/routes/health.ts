import { Hono } from "hono";
import { config } from "../config.ts";
import { registry } from "../metrics.ts";
import {
  API_TOKEN_PREFIX,
  extractBearerToken,
  hashApiToken,
  verifyBootstrapToken,
} from "../v1/auth-types.ts";
import type { FacetStore } from "../v1/types.ts";

const startTime = Date.now();

export type HealthRouteOptions = {
  store: FacetStore;
  getAuthToken?: (() => string) | undefined;
};

async function isHealthRequestAuthenticated(
  authorizationHeader: string | undefined,
  configuredAuthToken: string,
  store: FacetStore,
): Promise<boolean> {
  const token = extractBearerToken(authorizationHeader);
  if (
    configuredAuthToken !== "" &&
    token !== null &&
    verifyBootstrapToken(token, configuredAuthToken)
  ) {
    return true;
  }
  if (token?.startsWith(API_TOKEN_PREFIX) === true) {
    const matched = await store.authenticateApiToken(hashApiToken(token));
    return matched !== null;
  }
  return configuredAuthToken === "";
}

export function createHealthRoutes(options: HealthRouteOptions): Hono {
  const readAuthToken = options.getAuthToken ?? (() => config.authToken);
  const routes = new Hono();

  routes.get("/api/health", async (c) => {
    const authenticated = await isHealthRequestAuthenticated(
      c.req.header("Authorization"),
      readAuthToken(),
      options.store,
    );

    return c.json({
      success: true,
      data: {
        status: "ok",
        version: "0.1.0",
        uptime: Math.round((Date.now() - startTime) / 1000),
        authenticated,
      },
    });
  });

  routes.get("/metrics", async (c) => {
    const metrics = await registry.metrics();
    return c.text(metrics, 200, {
      "Content-Type": registry.contentType,
    });
  });

  return routes;
}
