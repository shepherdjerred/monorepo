import { expect, test, vi } from "vitest";
import { createFliptOperatorFetcher } from "./flipt-operator-fetcher.ts";
import type { FliptFetcher } from "./managed-flag-drift.ts";

test.each([undefined, "", " "])(
  "management writes require a credential before I/O",
  (token) => {
    expect(() =>
      createFliptOperatorFetcher("https://flipt.example", token),
    ).toThrow("FLIPT_OPERATOR_TOKEN is required");
  },
);

test("operator requests preserve request headers and reject redirect following", async () => {
  const upstream = vi.fn<FliptFetcher>(
    async () => new Response(null, { status: 401 }),
  );
  const fetcher = createFliptOperatorFetcher(
    "https://flipt.example",
    "test-operator-credential",
    upstream,
  );
  const response = await fetcher(
    new Request("https://flipt.example/api/v2/environments", {
      headers: { "X-Request-Id": "request" },
    }),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
  expect(response.status).toBe(401);
  expect(upstream).toHaveBeenCalledOnce();
  const options = upstream.mock.calls[0]?.[1];
  expect(options?.redirect).toBe("error");
  const headers = new Headers(options?.headers);
  expect(headers.get("Authorization")).toBe("Bearer test-operator-credential");
  expect(headers.get("X-Request-Id")).toBe("request");
  expect(headers.get("Content-Type")).toBe("application/json");
});

test("operator credentials cannot be sent to a different origin", () => {
  const upstream = vi.fn<FliptFetcher>();
  const fetcher = createFliptOperatorFetcher(
    "https://flipt.example",
    "test-operator-credential",
    upstream,
  );
  expect(() =>
    fetcher("https://different.example/api/v2/environments"),
  ).toThrow("changed origin");
  expect(upstream).not.toHaveBeenCalled();
});
