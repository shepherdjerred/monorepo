import { describe, expect, test } from "vitest";
import { createAuthenticatedFliptFetcher } from "./flipt-flag-inventory.ts";

describe("Flipt flag inventory authentication", () => {
  test("adds the operator bearer token without dropping request headers", async () => {
    let capturedHeaders: Headers | undefined;
    const fetcher = createAuthenticatedFliptFetcher(
      "test-operator-token",
      (_input, init) => {
        capturedHeaders = new Headers(init?.headers);
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    );

    await fetcher("https://flipt.example/api/v2/environments", {
      headers: { Accept: "application/json" },
    });

    expect(capturedHeaders?.get("Accept")).toBe("application/json");
    expect(capturedHeaders?.get("Authorization")).toBe(
      "Bearer test-operator-token",
    );
  });

  test("preserves headers carried by a Request input", async () => {
    let capturedHeaders: Headers | undefined;
    const fetcher = createAuthenticatedFliptFetcher(
      "test-operator-token",
      (_input, init) => {
        capturedHeaders = new Headers(init?.headers);
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    );
    const request = new Request("https://flipt.example/api/v2/flags", {
      headers: { "Content-Type": "application/json" },
    });

    await fetcher(request);

    expect(capturedHeaders?.get("Content-Type")).toBe("application/json");
    expect(capturedHeaders?.get("Authorization")).toBe(
      "Bearer test-operator-token",
    );
  });
});
