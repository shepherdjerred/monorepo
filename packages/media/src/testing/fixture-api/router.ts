import { z } from "zod";
import type { ApiErrorSchema } from "#shared/contract.ts";
import type { FixtureEndpoint, FixtureRequest } from "./endpoint.ts";
import { FIXTURE_ENDPOINTS } from "./endpoints.ts";
import { personaUser, type Persona } from "./personas.ts";
import { FixtureFailure, type FixtureScenario } from "./scenario.ts";

type ApiError = z.infer<typeof ApiErrorSchema>;
type FailureStatus = 400 | 403 | 404 | 501 | 502;

/** A served fixture, or the typed error body the real API would send. */
export type FixtureOutcome =
  | {
      status: 200;
      endpoint: FixtureEndpoint;
      request: FixtureRequest;
      body: unknown;
    }
  | { status: FailureStatus; body: ApiError };

type CompiledEndpoint = {
  endpoint: FixtureEndpoint;
  pattern: RegExp;
  names: readonly string[];
};

const LITERAL_SEGMENT = /^[\w-]+$/u;

function compile(endpoint: FixtureEndpoint): CompiledEndpoint {
  const names: string[] = [];
  const segments = endpoint.path.split("/").map((segment) => {
    if (segment.startsWith(":")) {
      names.push(segment.slice(1));
      return "([^/]+)";
    }
    if (segment !== "" && !LITERAL_SEGMENT.test(segment)) {
      throw new Error(`Unsupported fixture path segment in ${endpoint.path}`);
    }
    return segment;
  });
  return {
    endpoint,
    pattern: new RegExp(
      `^/api/v${String(endpoint.version)}${segments.join("/")}$`,
      "u",
    ),
    names,
  };
}

const COMPILED: readonly CompiledEndpoint[] = FIXTURE_ENDPOINTS.map(
  (endpoint) => compile(endpoint),
);

function failure(
  status: FailureStatus,
  code: string,
  message: string,
): FixtureOutcome {
  return { status, body: { error: { code, message } } };
}

type RouteInput = {
  method: string;
  url: URL;
  persona: Persona;
  /** Everything working, unless the browser chose otherwise. */
  scenario?: FixtureScenario;
};

function requestFor(
  compiled: CompiledEndpoint,
  match: RegExpExecArray,
  input: RouteInput,
): FixtureRequest {
  const parameters = new Map(
    compiled.names.map((name, index) => [
      name,
      decodeURIComponent(match[index + 1] ?? ""),
    ]),
  );
  return {
    persona: input.persona,
    scenario: input.scenario ?? "default",
    user: personaUser(input.persona),
    query: input.url.searchParams,
    param: (name) => {
      const value = parameters.get(name);
      if (value === undefined) {
        throw new Error(
          `${compiled.endpoint.path} declares no :${name} parameter`,
        );
      }
      return value;
    },
  };
}

function respond(
  endpoint: FixtureEndpoint,
  request: FixtureRequest,
): FixtureOutcome {
  try {
    const body = endpoint.respond(request);
    return body === null
      ? failure(404, "not_found", "This title could not be found.")
      : { status: 200, endpoint, request, body };
  } catch (error) {
    // A query the real API would reject is the caller's error, not ours.
    if (error instanceof z.ZodError) {
      return failure(400, "invalid_request", z.prettifyError(error));
    }
    // An error the real API sends on purpose, which a scenario asked for.
    if (error instanceof FixtureFailure) {
      return failure(error.status, error.code, error.message);
    }
    throw error;
  }
}

/**
 * Answer one request from the endpoint table. Only reads are served: the
 * fixture API holds no state, so a write gets a typed 501 instead of a
 * response that pretends something changed.
 */
export function routeFixture(input: RouteInput): FixtureOutcome {
  if (input.method !== "GET") {
    return failure(
      501,
      "fixture_read_only",
      "The fixture API is read-only; this change was not saved.",
    );
  }
  for (const compiled of COMPILED) {
    const match = compiled.pattern.exec(input.url.pathname);
    if (match === null) {
      continue;
    }
    return compiled.endpoint.access === "owner" && input.persona !== "owner"
      ? failure(403, "forbidden", "Library owner access is required.")
      : respond(compiled.endpoint, requestFor(compiled, match, input));
  }
  return failure(
    404,
    "fixture_missing",
    `The fixture API has no fixture for ${input.url.pathname}.`,
  );
}
