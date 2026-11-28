import {
  EXPERIMENTS_API_PATH,
  EXPERIMENTS_MAX_BODY_BYTES,
  EXPERIMENTS_OPERATOR_HEADER,
  EXPERIMENTS_REVIEW_SUMMARY_PATH,
  ExperimentIdSchema,
} from "@shepherdjerred/experiments/contract";
import type { Context, Env } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { ServerModule } from "#server/platform/module";

type VerifyOperator = (
  request: Request,
) => Promise<
  | { readonly login: string }
  | { readonly status: 401 | 403 | 503; readonly error: string }
>;

export type ExperimentsUpstream = {
  readonly origin: string;
  readonly token: string;
  readonly verifyOperator: VerifyOperator;
  readonly fetch?: (url: URL, request: RequestInit) => Promise<Response>;
};

const REQUEST_TIMEOUT_MS = 5000;
const ACTIONS = new Set(["start", "amend", "link", "evidence", "review"]);

function errorResponse(
  context: Context,
  message: string,
  status: 401 | 403 | 404 | 413 | 503,
) {
  return context.json(
    { error: message, code: `http_${String(status)}` },
    status,
  );
}

/** Hub's same-origin API presents only the experiment operations and sanitizes the upstream request. */
export function createExperimentsServerModule(
  upstream?: ExperimentsUpstream,
): ServerModule {
  const fetchUpstream = upstream?.fetch ?? globalThis.fetch;
  const writeLimit = bodyLimit({
    maxSize: EXPERIMENTS_MAX_BODY_BYTES,
    onError: (context) =>
      errorResponse(context, "Experiment request is too large.", 413),
  });

  async function forward(
    context: Context<Env, string>,
    suffix: string,
  ): Promise<Response> {
    if (upstream === undefined)
      return errorResponse(context, "Experiments is unavailable.", 503);
    const request = context.req.raw;
    const actor = await upstream.verifyOperator(request);
    if ("error" in actor)
      return errorResponse(context, actor.error, actor.status);

    const url = new URL(EXPERIMENTS_API_PATH + suffix, upstream.origin);
    if (suffix === "" && request.method === "GET") {
      const searchParams = new URL(request.url).searchParams;
      for (const key of ["view", "q"]) {
        const value = searchParams.get(key);
        if (value !== null) url.searchParams.set(key, value);
      }
    }

    const headers = {
      authorization: `Bearer ${upstream.token}`,
      "content-type": "application/json",
      [EXPERIMENTS_OPERATOR_HEADER]: actor.login,
    };

    async function send(body?: string): Promise<Response> {
      try {
        const response = await fetchUpstream(url, {
          method: request.method,
          redirect: "manual",
          headers,
          ...(body === undefined ? {} : { body }),
          signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          ]),
        });
        if (
          response.status >= 500 ||
          (response.status >= 300 && response.status < 400)
        ) {
          await response.body?.cancel();
          return errorResponse(context, "Experiments is unavailable.", 503);
        }
        return new Response(response.body, {
          status: response.status,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
        });
      } catch {
        return errorResponse(context, "Experiments is unavailable.", 503);
      }
    }

    if (request.method === "GET") return send();
    // The body limiter replaces streamed requests. Verify the Bun peer before it does.
    const limited = await writeLimit(context, async () => {
      context.res = await send(await context.req.raw.text());
    });
    return limited ?? context.res;
  }

  function forwardExperiment(
    context: Context<Env, string>,
    id: string,
    suffix = "",
  ): Promise<Response> | Response {
    return ExperimentIdSchema.safeParse(id).success
      ? forward(context, `/${encodeURIComponent(id)}${suffix}`)
      : errorResponse(context, "Experiment not found.", 404);
  }

  return {
    id: "experiments",
    register(routes) {
      routes.get("/", (context) => forward(context, ""));
      routes.post("/", (context) => forward(context, ""));
      routes.get("/:id", (context) =>
        forwardExperiment(context, context.req.param("id")),
      );
      routes.patch("/:id", (context) =>
        forwardExperiment(context, context.req.param("id")),
      );
      routes.post("/:id/:action", (context) => {
        const action = context.req.param("action");
        return ACTIONS.has(action)
          ? forwardExperiment(context, context.req.param("id"), `/${action}`)
          : errorResponse(context, "Experiment action not found.", 404);
      });
    },
    async ready() {
      if (upstream === undefined) return false;
      try {
        const response = await fetchUpstream(
          new URL(EXPERIMENTS_REVIEW_SUMMARY_PATH, upstream.origin),
          {
            redirect: "manual",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          },
        );
        await response.body?.cancel();
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
