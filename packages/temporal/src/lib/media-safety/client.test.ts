import { expect, test } from "vitest";
import { loginQbittorrent, MediaApi } from "./client.ts";

test("uses qBittorrent 5.2's 204 response and port-specific session cookie", async () => {
  const client = await loginQbittorrent(
    "http://fixture:8080",
    "fixture",
    "fixture",
    async () =>
      new Response(null, {
        status: 204,
        headers: { "set-cookie": "QBT_SID_8080=fixture; HttpOnly" },
      }),
  );
  expect(client.headers["Cookie"]).toBe("QBT_SID_8080=fixture");
});
test.each([200, 401, 403])(
  "rejects unsuccessful or incompatible authentication: %s",
  async (status) => {
    await expect(
      loginQbittorrent(
        "http://fixture:8080",
        "fixture",
        "fixture",
        async () => new Response("", { status }),
      ),
    ).rejects.toThrow();
  },
);
test("missing session cookies fail even when the login status succeeds", async () => {
  await expect(
    loginQbittorrent(
      "http://fixture:8080",
      "fixture",
      "fixture",
      async () => new Response(null, { status: 204 }),
    ),
  ).rejects.toThrow("authentication failed");
});
test("does not leak response bodies or credentials in API errors", async () => {
  const api = new MediaApi(
    "http://fixture",
    { "X-Api-Key": "private fixture" },
    async () => new Response("private response body", { status: 500 }),
  );
  await expect(api.json("indexer")).rejects.toMatchObject({
    message: "Media API GET failed: HTTP 500",
  });
});

test("malformed successful responses cannot expose their body or query in errors", async () => {
  const api = new MediaApi(
    "http://fixture",
    {},
    async () => new Response("fictional_sensitive_response"),
  );
  await expect(api.json("indexer?token=private-query")).rejects.toMatchObject({
    message: "Media API GET indexer returned invalid JSON",
  });
});
