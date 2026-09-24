import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  fetchJson,
  UpstreamError,
  type Fetch,
} from "@shepherdjerred/ops-clients/http.ts";

function respond(body: unknown, status = 200): Fetch {
  return () => Promise.resolve(Response.json(body, { status }));
}

const Schema = z.object({ value: z.number() });

describe("fetchJson", () => {
  test("returns validated data", async () => {
    await expect(
      fetchJson(
        respond({ value: 1 }),
        { upstream: "x", url: "http://x" },
        Schema,
      ),
    ).resolves.toEqual({ value: 1 });
  });

  test("rejects non-2xx without echoing the body", async () => {
    const request = fetchJson(
      respond({ secret: "token" }, 503),
      { upstream: "x", url: "http://x" },
      Schema,
    );
    await expect(request).rejects.toBeInstanceOf(UpstreamError);
    await expect(request).rejects.toThrow(/^x: HTTP 503$/);
  });

  test("rejects a schema mismatch with bounded paths", async () => {
    await expect(
      fetchJson(
        respond({ value: "nope" }),
        { upstream: "x", url: "http://x" },
        Schema,
      ),
    ).rejects.toThrow("x: response did not match schema at value");
  });
});
