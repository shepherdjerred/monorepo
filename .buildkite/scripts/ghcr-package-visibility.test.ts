import { expect, test } from "bun:test";

import { ensureDeclaredGhcrPackageVisibility } from "./ghcr-package-visibility.ts";

test("makes a declared first-party package public through GitHub Packages", async () => {
  const requests: {
    url: string;
    method: string | undefined;
    authorization: string | null;
    body: string;
  }[] = [];
  await ensureDeclaredGhcrPackageVisibility(
    "openrouter-broadcast-ingest",
    "test-token",
    async (input, init) => {
      if (typeof init.body !== "string") {
        throw new TypeError("GitHub Packages request body must be JSON text");
      }
      requests.push({
        url: input.toString(),
        method: init.method,
        authorization: new Headers(init.headers).get("authorization"),
        body: init.body,
      });
      return new Response(null, { status: 204 });
    },
  );
  expect(requests).toHaveLength(1);
  const request = requests[0];
  expect(request?.url).toBe(
    "https://api.github.com/user/packages/container/openrouter-broadcast-ingest",
  );
  expect(request?.method).toBe("PATCH");
  expect(request?.authorization).toBe("Bearer test-token");
  expect(JSON.parse(request?.body ?? "")).toEqual({ visibility: "public" });
});

test("leaves unlisted packages untouched", async () => {
  await ensureDeclaredGhcrPackageVisibility(
    "external-image",
    undefined,
    async () => {
      throw new Error("unlisted package must not call GitHub");
    },
  );
});

test("fails with a clear permission error", async () => {
  await expect(
    ensureDeclaredGhcrPackageVisibility(
      "birmel",
      "test-token",
      async () =>
        new Response("forbidden", { status: 403, statusText: "Forbidden" }),
    ),
  ).rejects.toThrow("Grant GH_TOKEN package administration permission");
});
