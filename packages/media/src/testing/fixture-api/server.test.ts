import { describe, expect, it } from "vitest";
import { ApiErrorSchema, UserSchema } from "#shared/contract.ts";
import {
  ArtworkSizeSchema,
  hasArtworkSignature,
} from "#shared/artwork/proxy.ts";
import { posterPath } from "./fixtures/artwork.ts";
import { UNREACHABLE_POSTER_TITLE } from "./fixtures/artwork-image.ts";
import { PERSONA_COOKIE, createFixtureApi } from "./server.ts";

function harness(defaultPersona: "owner" | "member" = "owner") {
  const lines: string[] = [];
  const handle = createFixtureApi({
    defaultPersona,
    log: (line) => {
      lines.push(line);
    },
  });
  return {
    lines,
    request: (path: string, init?: RequestInit) => {
      const response = handle(
        new Request(`http://fixture.invalid${path}`, init),
      );
      if (response === null) {
        throw new Error(`${path} was not handled by the fixture API`);
      }
      return response;
    },
    handle,
  };
}

async function errorCode(response: Response): Promise<string> {
  return ApiErrorSchema.parse(await response.json()).error.code;
}

describe("fixture API server", () => {
  it("leaves everything outside /api to the caller", () => {
    const { handle } = harness();
    expect(handle(new Request("http://fixture.invalid/library"))).toBeNull();
  });

  it("serves the default persona without a cookie", async () => {
    const response = harness("member").request("/api/v1/me");
    expect(response.status).toBe(200);
    expect(UserSchema.parse(await response.json()).role).toBe("member");
  });

  it("lets a browser switch persona without restarting", async () => {
    const { request } = harness("owner");
    const switched = request("/api/fixture/persona/member");
    expect(switched.status).toBe(303);
    expect(switched.headers.get("location")).toBe("/");
    const cookie = switched.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${PERSONA_COOKIE}=member`);

    const response = request("/api/v1/me", {
      headers: { cookie: `other=1; ${PERSONA_COOKIE}=member` },
    });
    expect(UserSchema.parse(await response.json()).role).toBe("member");
  });

  it("rejects an unknown persona instead of guessing one", async () => {
    const { request } = harness();
    const fromCookie = request("/api/v1/me", {
      headers: { cookie: `${PERSONA_COOKIE}=guest` },
    });
    expect(fromCookie.status).toBe(400);
    expect(await errorCode(fromCookie)).toBe("fixture_persona_invalid");
    expect(request("/api/fixture/persona/guest").status).toBe(400);
  });

  it("refuses every write with a typed 501 and logs it", async () => {
    const { request, lines } = harness();
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const response = request("/api/v1/requests", { method });
      expect(response.status).toBe(501);
      expect(await errorCode(response)).toBe("fixture_read_only");
    }
    expect(lines).toContain("refused write: POST /api/v1/requests");
  });

  it("answers an unknown path with a typed 404 and logs the path", async () => {
    const { request, lines } = harness();
    const response = request("/api/v1/does-not-exist?cursor=1");
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("fixture_missing");
    expect(lines).toEqual(["no fixture: GET /api/v1/does-not-exist?cursor=1"]);
  });

  it("answers an unknown title with the API's own 404, unlogged", async () => {
    const { request, lines } = harness();
    const response = request(
      "/api/v1/media/00000002-0000-4000-8000-00000000ffff",
    );
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("not_found");
    expect(lines).toEqual([]);
  });

  it("answers a query the API would reject with a typed 400", async () => {
    const response = harness().request("/api/v1/library?kind=podcast");
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_request");
  });

  it("draws a PNG for every artwork size, the same bytes each time", async () => {
    const { request } = harness();
    const file = posterPath("Dune");
    for (const size of ArtworkSizeSchema.options) {
      const response = request(`/api/v1/artwork/${size}${file}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("cache-control")).toBe(
        "private, max-age=31536000, immutable",
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(hasArtworkSignature("image/png", bytes)).toBe(true);
      const again = request(`/api/v1/artwork/${size}${file}`);
      expect(new Uint8Array(await again.arrayBuffer())).toEqual(bytes);
    }
  });

  it("fails one poster the way an unreachable TMDB does, and refuses what the proxy refuses", async () => {
    const { request, lines } = harness();
    const unreachable = request(
      `/api/v1/artwork/w342${posterPath(UNREACHABLE_POSTER_TITLE)}`,
    );
    expect(unreachable.status).toBe(502);
    expect(await errorCode(unreachable)).toBe("artwork_unavailable");
    for (const path of [
      `/api/v1/artwork/original${posterPath("Dune")}`,
      "/api/v1/artwork/w342/..%2Fsecret.png",
      "/api/v1/artwork/w342/abcdefgh.svg",
    ]) {
      const refused = request(path);
      expect(refused.status, path).toBe(400);
      expect(await errorCode(refused)).toBe("invalid_input");
    }
    expect(lines).toEqual([]);
  });

  it("never lets a response be cached", () => {
    expect(harness().request("/api/v1/me").headers.get("cache-control")).toBe(
      "no-store",
    );
  });
});
