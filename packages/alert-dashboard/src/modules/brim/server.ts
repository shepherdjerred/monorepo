import { authenticate } from "@shepherdjerred/flags/auth.ts";
import {
  createFlagsTrustedProxyAddresses,
  createProjectedFlagsKubernetesReader,
  type TailscaleIngressTarget,
} from "@shepherdjerred/flags/ingress-proxy.ts";
import type { Context } from "hono";

import type { ServerModule } from "#server/platform/module";

const hubIngress: TailscaleIngressTarget = {
  namespace: "alert-dashboard",
  name: "alert-dashboard-alert-dashboard-hub-ingress-ingress",
  proxyNamespace: "tailscale",
  serviceName: "alert-dashboard-alert-dashboard-service",
  port: 7341,
  host: "hub",
};

export function createBrimOperatorCheck(options: {
  readonly identityDirectory: string;
  readonly operatorLogins: readonly string[];
  readonly peerAddress: (request: Request) => string | null;
}): BrimOperatorCheck {
  const trustedProxyAddresses = createFlagsTrustedProxyAddresses(
    createProjectedFlagsKubernetesReader(
      options.identityDirectory,
      undefined,
      "alert-dashboard",
    ),
    hubIngress,
  );
  return async (request) => {
    const principal = await authenticate(
      request,
      options.peerAddress(request),
      {
        machineToken: undefined,
        operatorLogins: options.operatorLogins,
        trustedProxyAddresses,
        publicOrigin: new URL(request.url).origin,
      },
    );
    return "status" in principal ? principal : null;
  };
}

type BrimOperatorCheck = (request: Request) => Promise<{
  readonly status: 401 | 403 | 503;
  readonly error: string;
} | null>;

const READ_PATH =
  /^\/v1\/(?:overview|priorities|history\/(?:sessions(?:\/[1-9]\d*)?|search|facets|usage|blocks|captures(?:\/[1-9]\d*)?))$/u;
const API_PREFIX = "/api/brim";
const PRIVATE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export function createBrimServerModule(
  config: {
    readonly origin: string;
    readonly token: string;
    readonly authorize: BrimOperatorCheck;
    readonly fetch?: typeof globalThis.fetch;
  } | null,
): ServerModule {
  const requestUpstream = config?.fetch ?? globalThis.fetch;
  const origin = config === null ? null : new URL(config.origin).origin;
  return {
    id: "brim",
    ready: async () => {
      if (origin === null) return false;
      try {
        const response = await requestUpstream(new URL("/healthz", origin), {
          signal: AbortSignal.timeout(3000),
          redirect: "error",
        });
        await response.body?.cancel();
        return response.ok;
      } catch {
        return false;
      }
    },
    register(app) {
      app.get("/v1/*", async (context: Context) => {
        const path = context.req.path.slice(API_PREFIX.length);
        if (!READ_PATH.test(path)) {
          return context.json({ error: "Not found" }, 404, PRIVATE_HEADERS);
        }
        if (config === null || origin === null) {
          return context.json(
            { error: "Brim has not been configured in Hub" },
            503,
            PRIVATE_HEADERS,
          );
        }
        const failure = await config.authorize(context.req.raw);
        if (failure !== null) {
          return context.json(
            { error: failure.error },
            failure.status,
            PRIVATE_HEADERS,
          );
        }
        const target = new URL(path, origin);
        target.search = new URL(context.req.url).search;
        try {
          const upstream = await requestUpstream(target, {
            redirect: "error",
            signal: AbortSignal.any([
              context.req.raw.signal,
              AbortSignal.timeout(15_000),
            ]),
            headers: {
              accept: "application/json",
              authorization: `Bearer ${config.token}`,
            },
          });
          if (
            (upstream.status !== 200 &&
              upstream.status !== 400 &&
              upstream.status !== 404 &&
              upstream.status !== 503) ||
            upstream.headers
              .get("content-type")
              ?.startsWith("application/json") !== true
          ) {
            await upstream.body?.cancel();
            throw new Error("Unexpected Brim response");
          }
          return new Response(upstream.body, {
            status: upstream.status,
            headers: { ...PRIVATE_HEADERS, "content-type": "application/json" },
          });
        } catch {
          return context.json(
            { error: "Brim is currently unavailable" },
            502,
            PRIVATE_HEADERS,
          );
        }
      });
    },
  };
}
