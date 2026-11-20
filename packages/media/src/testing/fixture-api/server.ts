import { UserRoleSchema } from "#shared/contract.ts";
import type { Persona } from "./personas.ts";
import { routeFixture } from "./router.ts";

/** Cookie that selects the signed-in persona for one browser. */
export const PERSONA_COOKIE = "media-fixture-persona";
const PERSONA_SWITCH = /^\/api\/fixture\/persona\/([^/]+)$/u;

export type FixtureApiOptions = {
  /** Persona served to a browser that has not chosen one. */
  defaultPersona: Persona;
  /** Receives one line per unknown path and per refused write. */
  log: (line: string) => void;
};

function json(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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

/** `GET /api/fixture/persona/<persona>` signs this browser in as that persona. */
function switchPersona(value: string): Response {
  const persona = UserRoleSchema.safeParse(value);
  if (!persona.success) {
    return invalidPersona(value);
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/",
      "Set-Cookie": `${PERSONA_COOKIE}=${persona.data}; Path=/; SameSite=Lax`,
      "Cache-Control": "no-store",
    },
  });
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
    const chosen = cookie(request, PERSONA_COOKIE);
    const persona = UserRoleSchema.safeParse(chosen ?? options.defaultPersona);
    if (!persona.success) {
      return invalidPersona(chosen ?? "");
    }
    const outcome = routeFixture({
      method: request.method,
      url,
      persona: persona.data,
    });
    if (outcome.status === 501) {
      options.log(`refused write: ${request.method} ${url.pathname}`);
    } else if (
      outcome.status === 404 &&
      outcome.body.error.code === "fixture_missing"
    ) {
      options.log(`no fixture: GET ${url.pathname}${url.search}`);
    }
    return json(outcome.status, outcome.body);
  };
}
