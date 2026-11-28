import { UserRoleSchema } from "#shared/contract.ts";
import { fixtureArtwork } from "./fixtures/artwork-image.ts";
import type { Persona } from "./personas.ts";
import { routeFixture } from "./router.ts";
import {
  FixtureScenarioSchema,
  SCENARIO_COOKIE,
  type FixtureScenario,
} from "./scenario.ts";

/** Cookie that selects the signed-in persona for one browser. */
export const PERSONA_COOKIE = "media-fixture-persona";
/** CSRF cookie read by `writeApi` so fixture writes reach the router's 501. */
export const FIXTURE_CSRF_COOKIE = "media-csrf";
export const FIXTURE_CSRF_TOKEN = "fixture-csrf";
const CSRF_SET_COOKIE = `${FIXTURE_CSRF_COOKIE}=${FIXTURE_CSRF_TOKEN}; Path=/; SameSite=Lax`;
const PERSONA_SWITCH = /^\/api\/fixture\/persona\/([^/]+)$/u;
const SCENARIO_SWITCH = /^\/api\/fixture\/scenario\/([^/]+)$/u;
const ARTWORK = /^\/api\/v1\/artwork\/([^/]+)\/([^/]+)$/u;

export type FixtureApiOptions = {
  /** Persona served to a browser that has not chosen one. */
  defaultPersona: Persona;
  /** Receives one line per unknown path and per refused write. */
  log: (line: string) => void;
};

function json(status: number, body: unknown, setCookie?: string): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (setCookie !== undefined) {
    headers.append("Set-Cookie", setCookie);
  }
  return Response.json(body, { status, headers });
}

function invalidPersona(value: string): Response {
  return json(400, {
    error: {
      code: "fixture_persona_invalid",
      message: `Unknown fixture persona "${value}"; use ${UserRoleSchema.options.join(" or ")}.`,
    },
  });
}

function cookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (header === null) {
    return null;
  }
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator !== -1 && entry.slice(0, separator).trim() === name) {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    }
  }
  return null;
}

function hasCsrfCookie(request: Request): boolean {
  return (
    cookie(request, FIXTURE_CSRF_COOKIE) !== null ||
    cookie(request, "__Host-media-csrf") !== null
  );
}

/** `GET /api/fixture/persona/<persona>` signs this browser in as that persona. */
function switchPersona(value: string): Response {
  const persona = UserRoleSchema.safeParse(value);
  if (!persona.success) {
    return invalidPersona(value);
  }
  const headers = new Headers({
    Location: "/",
    "Cache-Control": "no-store",
  });
  headers.append(
    "Set-Cookie",
    `${PERSONA_COOKIE}=${persona.data}; Path=/; SameSite=Lax`,
  );
  headers.append("Set-Cookie", CSRF_SET_COOKIE);
  return new Response(null, { status: 303, headers });
}

function invalidScenario(value: string): Response {
  return json(400, {
    error: {
      code: "fixture_scenario_invalid",
      message: `Unknown fixture scenario "${value}"; use ${FixtureScenarioSchema.options.join(", ")}.`,
    },
  });
}

/**
 * `GET /api/fixture/scenario/<scenario>` puts the fixture API in that
 * condition for this browser, until it chooses `default` again.
 */
function switchScenario(value: string): Response {
  const scenario = FixtureScenarioSchema.safeParse(value);
  if (!scenario.success) {
    return invalidScenario(value);
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/",
      "Set-Cookie": `${SCENARIO_COOKIE}=${scenario.data}; Path=/; SameSite=Lax`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * `GET /api/v1/artwork/:size/:file`, the one read that is not JSON. A success
 * carries the headers the real route sends; a failure is the typed error body
 * every other route sends.
 */
function artwork(size: string, file: string): Response {
  const image = fixtureArtwork(size, file);
  if (image.status !== 200) {
    return json(image.status, {
      error: { code: image.code, message: image.message },
    });
  }
  return new Response(image.bytes, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(image.bytes.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

/**
 * The persona and scenario this browser chose by cookie, or the refusal of
 * one it could not have chosen.
 */
function browserChoices(
  request: Request,
  defaultPersona: Persona,
): { persona: Persona; scenario: FixtureScenario } | Response {
  const chosen = cookie(request, PERSONA_COOKIE);
  const persona = UserRoleSchema.safeParse(chosen ?? defaultPersona);
  if (!persona.success) {
    return invalidPersona(chosen ?? "");
  }
  const asked = cookie(request, SCENARIO_COOKIE);
  const scenario = FixtureScenarioSchema.safeParse(asked ?? "default");
  return scenario.success
    ? { persona: persona.data, scenario: scenario.data }
    : invalidScenario(asked ?? "");
}

/**
 * The fixture API as a request handler. Returns null for anything outside
 * `/api/`, so the caller decides how the client itself is served (the Vite
 * dev server in `dev:fixture`, the built bundle in the browser tests).
 */
export function createFixtureApi(
  options: FixtureApiOptions,
): (request: Request) => Response | null {
  return (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return null;
    }
    const personaSwitch = PERSONA_SWITCH.exec(url.pathname);
    if (personaSwitch !== null && request.method === "GET") {
      return switchPersona(decodeURIComponent(personaSwitch[1] ?? ""));
    }
    const scenarioSwitch = SCENARIO_SWITCH.exec(url.pathname);
    if (scenarioSwitch !== null && request.method === "GET") {
      return switchScenario(decodeURIComponent(scenarioSwitch[1] ?? ""));
    }
    const image = ARTWORK.exec(url.pathname);
    if (image !== null && request.method === "GET") {
      return artwork(
        decodeURIComponent(image[1] ?? ""),
        decodeURIComponent(image[2] ?? ""),
      );
    }
    const browser = browserChoices(request, options.defaultPersona);
    if (browser instanceof Response) {
      return browser;
    }
    const outcome = routeFixture({ method: request.method, url, ...browser });
    if (outcome.status === 501) {
      options.log(`refused write: ${request.method} ${url.pathname}`);
    } else if (
      outcome.status === 404 &&
      outcome.body.error.code === "fixture_missing"
    ) {
      options.log(`no fixture: GET ${url.pathname}${url.search}`);
    }
    const setCookie =
      request.method === "GET" &&
      url.pathname === "/api/v1/me" &&
      outcome.status === 200 &&
      !hasCsrfCookie(request)
        ? CSRF_SET_COOKIE
        : undefined;
    return json(outcome.status, outcome.body, setCookie);
  };
}
