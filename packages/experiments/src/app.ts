import { createHash, timingSafeEqual } from "node:crypto";
import { serveStatic } from "@hono/bun";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { z } from "zod";
import {
  AmendExperimentSchema,
  CreateExperimentSchema,
  EditExperimentSchema,
  EvidenceExperimentSchema,
  EXPERIMENTS_API_PATH,
  EXPERIMENTS_MAX_BODY_BYTES,
  EXPERIMENTS_OPERATOR_HEADER,
  EXPERIMENTS_REVIEW_SUMMARY_PATH,
  ExperimentIdSchema,
  ExperimentListQuerySchema,
  LinkExperimentSchema,
  ReviewExperimentSchema,
  StartExperimentSchema,
} from "./contract.ts";
import { ExperimentFailure, pacificDate } from "./domain.ts";
import type { OperatorVerifier } from "./operator-identity.ts";
import type { ExperimentStore, ExperimentWrite } from "./store.ts";

type Environment = { Variables: { actor: string } };
type ApiContext = Context<Environment>;
type Authenticate = MiddlewareHandler<Environment>;
type AppOptions = { store: ExperimentStore; now?: () => Date };

function errorResponse(
  c: ApiContext,
  status: 400 | 401 | 403 | 404 | 413 | 415 | 500 | 503,
  code: string,
  error: string,
) {
  return c.json({ error, code }, status);
}

class BadInput extends Error {
  constructor(
    readonly status: 400 | 415,
    message: string,
  ) {
    super(message);
  }
}

function parse<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const [issue] = parsed.error.issues;
  const field = issue?.path.map(String).join(".");
  const message = issue?.message ?? "Invalid value";
  throw new BadInput(
    400,
    field === undefined || field === "" ? message : `${field}: ${message}`,
  );
}

function idOf(c: ApiContext) {
  return parse(ExperimentIdSchema, c.req.param("id"));
}

async function json<T extends z.ZodType>(
  c: ApiContext,
  schema: T,
): Promise<z.output<T>> {
  const mediaType = c.req
    .header("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new BadInput(415, "Expected application/json");
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new BadInput(400, "Malformed JSON request");
  }
  return parse(schema, body);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function actorTokenMatches(header: string | undefined, token: string): boolean {
  return (
    header?.startsWith("Bearer ") === true &&
    timingSafeEqual(digest(header.slice(7)), digest(token))
  );
}

function baseApp(store: ExperimentStore) {
  const app = new Hono<Environment>();
  app.use(secureHeaders());
  app.get("/healthz", (c) => c.text("ok"));
  app.get("/readyz", async (c) =>
    (await store.ping())
      ? c.text("ok")
      : errorResponse(
          c,
          503,
          "unavailable",
          "Experiments database unavailable",
        ),
  );
  app.notFound((c) => errorResponse(c, 404, "not_found", "Route not found"));
  app.onError((error, c) => {
    if (error instanceof BadInput)
      return errorResponse(c, error.status, "invalid_input", error.message);
    if (error instanceof ExperimentFailure)
      return c.json({ error: error.message, code: error.code }, error.status);
    console.error(
      JSON.stringify({
        message: "experiments_request_failed",
        errorType: error.name,
      }),
    );
    return errorResponse(c, 500, "internal_error", "Experiment request failed");
  });
  return app;
}

function withExperimentApi(
  app: Hono<Environment>,
  { store, now = () => new Date() }: AppOptions,
  authenticate: Authenticate,
) {
  const api = new Hono<Environment>();
  api.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  api.use("*", authenticate);
  api.use(
    "*",
    bodyLimit({
      maxSize: EXPERIMENTS_MAX_BODY_BYTES,
      onError: (c) =>
        c.json({ error: "Request is too large", code: "body_too_large" }, 413),
    }),
  );

  function write(c: ApiContext, command: ExperimentWrite) {
    const at = now();
    return store.write(command, {
      actor: c.get("actor"),
      at: at.toISOString(),
      today: pacificDate(at),
    });
  }

  api.get("/", async (c) =>
    c.json({
      items: await store.list(
        parse(ExperimentListQuerySchema, c.req.query()),
        pacificDate(now()),
      ),
    }),
  );
  api.get("/:id", async (c) => {
    const experiment = await store.find(idOf(c), pacificDate(now()));
    return experiment === null
      ? errorResponse(c, 404, "not_found", "Experiment not found")
      : c.json(experiment);
  });
  api.post("/", async (c) =>
    c.json(
      await write(c, {
        kind: "create",
        input: await json(c, CreateExperimentSchema),
      }),
      201,
    ),
  );
  api.patch("/:id", async (c) =>
    c.json(
      await write(c, {
        id: idOf(c),
        command: { kind: "edit", input: await json(c, EditExperimentSchema) },
      }),
    ),
  );
  api.post("/:id/start", async (c) =>
    c.json(
      await write(c, {
        id: idOf(c),
        command: { kind: "start", input: await json(c, StartExperimentSchema) },
      }),
    ),
  );
  api.post("/:id/amend", async (c) =>
    c.json(
      await write(c, {
        id: idOf(c),
        command: { kind: "amend", input: await json(c, AmendExperimentSchema) },
      }),
    ),
  );
  api.post("/:id/link", async (c) =>
    c.json(
      await write(c, {
        id: idOf(c),
        command: { kind: "link", input: await json(c, LinkExperimentSchema) },
      }),
    ),
  );
  api.post("/:id/evidence", async (c) =>
    c.json(
      await write(c, {
        id: idOf(c),
        command: {
          kind: "evidence",
          input: await json(c, EvidenceExperimentSchema),
        },
      }),
    ),
  );
  api.post("/:id/review", async (c) =>
    c.json(
      await write(c, {
        id: idOf(c),
        command: {
          kind: "review",
          input: await json(c, ReviewExperimentSchema),
        },
      }),
    ),
  );
  app.route(EXPERIMENTS_API_PATH, api);
}

export function createPublicExperimentApp(
  options: AppOptions & {
    machineToken: string;
    verifyOperator: OperatorVerifier;
    peerAddress: (request: Request) => string | null;
    browserRoot?: string;
  },
) {
  const app = baseApp(options.store);
  app.get("/metrics", (c) =>
    c.text(
      "# HELP experiments_up Experiments process availability.\n# TYPE experiments_up gauge\nexperiments_up 1\n",
      200,
      { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
    ),
  );

  const human: Authenticate = async (c, next) => {
    const request = c.req.raw;
    const operator = await options.verifyOperator(
      request,
      options.peerAddress(request),
    );
    if ("status" in operator)
      return errorResponse(
        c,
        operator.status,
        "operator_authorization",
        operator.error,
      );
    c.set("actor", operator.login);
    return next();
  };
  withExperimentApi(app, options, async (c, next) => {
    const authorization = c.req.header("authorization");
    if (authorization === undefined) return human(c, next);
    if (!actorTokenMatches(authorization, options.machineToken))
      return errorResponse(
        c,
        401,
        "invalid_credential",
        "Invalid machine credential",
      );
    c.set("actor", "toolkit");
    return next();
  });

  if (options.browserRoot !== undefined) {
    const index = serveStatic<Environment>({
      root: options.browserRoot,
      path: "index.html",
    });
    app.get(
      "/assets/*",
      serveStatic({
        root: options.browserRoot,
        onFound: (_path, c) => {
          c.header("Cache-Control", "public, max-age=31536000, immutable");
        },
      }),
    );
    app.get("/", human, index);
    app.get("/experiments", human, index);
    app.get("/experiments/:page", human, index);
  }
  return app;
}

export function createInternalExperimentApp(
  options: AppOptions & { hubToken: string; operatorLogins: readonly string[] },
) {
  const app = baseApp(options.store);
  withExperimentApi(app, options, async (c, next) => {
    if (!actorTokenMatches(c.req.header("authorization"), options.hubToken))
      return errorResponse(
        c,
        401,
        "invalid_credential",
        "Invalid Hub service credential",
      );
    const login = c.req.header(EXPERIMENTS_OPERATOR_HEADER);
    if (login === undefined || !options.operatorLogins.includes(login))
      return errorResponse(
        c,
        403,
        "operator_authorization",
        "Verified operator required",
      );
    c.set("actor", login);
    return next();
  });
  app.get(EXPERIMENTS_REVIEW_SUMMARY_PATH, async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({
      dueCount: await options.store.countDue(
        pacificDate((options.now ?? (() => new Date()))()),
      ),
    });
  });
  return app;
}
