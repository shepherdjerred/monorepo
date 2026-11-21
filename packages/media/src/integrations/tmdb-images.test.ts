import { describe, expect, test, vi } from "vitest";
import {
  jpeg,
  png,
  POSTER,
} from "#infrastructure/artwork/artwork.test-support.ts";
import { IntegrationError, type FetchTransport } from "./http.ts";
import { TmdbImageClient } from "./tmdb-images.ts";

function respond(
  body: BodyInit | null,
  contentType: string | null,
  status = 200,
): FetchTransport {
  return () =>
    Promise.resolve(
      new Response(body, {
        status,
        headers: contentType === null ? {} : { "Content-Type": contentType },
      }),
    );
}

async function failure(transport: FetchTransport, file = POSTER) {
  try {
    await new TmdbImageClient(transport).image("w342", file);
  } catch (error) {
    if (error instanceof IntegrationError) return error;
    throw error;
  }
  throw new Error("Expected the image to be rejected");
}

describe("TMDB image client", () => {
  test("requests the fixed CDN path without a credential and without following redirects", async () => {
    const transport = vi.fn<FetchTransport>(respond(jpeg(), "image/jpeg"));
    const image = await new TmdbImageClient(transport).image("w342", POSTER);
    expect(image).toEqual({
      status: "found",
      bytes: jpeg(),
      contentType: "image/jpeg",
    });
    const [url, init] = transport.mock.calls[0] ?? [];
    expect(url?.href).toBe(`https://image.tmdb.org/t/p/w342/${POSTER}`);
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual({ Accept: "image/jpeg" });
  });

  test("accepts a PNG whose declared type carries parameters", async () => {
    const image = await new TmdbImageClient(
      respond(png(), "Image/PNG; charset=binary"),
    ).image("w185", "abcdefgh.png");
    expect(image).toMatchObject({ status: "found", contentType: "image/png" });
  });

  test("reports an upstream 404 as missing", async () => {
    await expect(
      new TmdbImageClient(respond("gone", "text/plain", 404)).image(
        "w500",
        POSTER,
      ),
    ).resolves.toEqual({ status: "missing" });
  });

  test.each([
    ["a redirect", respond(null, null, 302), "unavailable", 302],
    ["a server error", respond("busy", "text/plain", 503), "unavailable", 503],
    ["a rate limit", respond(null, null, 429), "rate-limited", 429],
    [
      "a partial response",
      respond(jpeg(), "image/jpeg", 206),
      "invalid-response",
      206,
    ],
    ["no content type", respond(jpeg(), null), "invalid-response", 200],
    ["an HTML page", respond("<html>", "text/html"), "invalid-response", 200],
    [
      "an SVG document",
      respond("<svg/>", "image/svg+xml"),
      "invalid-response",
      200,
    ],
    [
      "a type that disagrees with the extension",
      respond(png(), "image/png"),
      "invalid-response",
      200,
    ],
    [
      "bytes that disagree with the declared type",
      respond(png(), "image/jpeg"),
      "invalid-response",
      200,
    ],
    [
      "markup declared as an image",
      respond("<script>alert(1)</script>", "image/jpeg"),
      "invalid-response",
      200,
    ],
    [
      "an empty body",
      respond(null, "image/jpeg"),
      "invalid-response",
      undefined,
    ],
    [
      "a signature with nothing after it",
      respond(jpeg(3), "image/jpeg"),
      "invalid-response",
      200,
    ],
    [
      "more than four mebibytes",
      respond(jpeg(4 * 1024 * 1024 + 1), "image/jpeg"),
      "invalid-response",
      undefined,
    ],
  ] as const)("rejects %s", async (_case, transport, kind, status) => {
    const error = await failure(transport);
    expect(error.service).toBe("tmdb-images");
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
  });

  test("reports an unreachable or timed-out CDN as unavailable", async () => {
    const error = await failure(() =>
      Promise.reject(new DOMException("timed out", "TimeoutError")),
    );
    expect(error.kind).toBe("unavailable");
  });

  test.each([
    "poster.svg",
    "../../../etc/passwd",
    "short.jpg",
    `${POSTER}?x=1`,
    `${POSTER}/..`,
  ])("never contacts the CDN for the file name %s", async (file) => {
    const transport = vi.fn<FetchTransport>(respond(jpeg(), "image/jpeg"));
    await expect(
      new TmdbImageClient(transport).image("w342", file),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
