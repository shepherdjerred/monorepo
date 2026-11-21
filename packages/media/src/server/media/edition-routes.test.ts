import { expect, test, vi } from "vitest";
import type { MediaApplication } from "#application/ports.ts";
import { createMediaApp } from "#server/app.ts";
import { actor, fixture, headers } from "#server/http.test-support.ts";

const url = "/api/v2/targets/default";

function batchApp() {
  const { dependencies } = fixture();
  const read = vi.fn<MediaApplication["getDefaultCommandContexts"]>(
    (_actor, mediaIds) =>
      Promise.resolve({
        schemaVersion: 2,
        items: mediaIds.map((mediaId) => ({
          status: "unavailable",
          mediaId,
          code: "media_not_found",
        })),
      }),
  );
  const afterWrite = vi.fn(() => Promise.resolve());
  dependencies.media = {
    ...dependencies.media,
    getDefaultCommandContexts: read,
  };
  dependencies.afterWrite = afterWrite;
  return { app: createMediaApp(dependencies), read, afterWrite };
}

test("the batch target read requires a session", async () => {
  const { app, read } = batchApp();
  const response = await app.request(`${url}?ids=${crypto.randomUUID()}`);
  expect(response.status).toBe(401);
  expect(read).not.toHaveBeenCalled();
});

test.each([
  ["no ids query", ""],
  ["an empty list", "?ids="],
  ["an empty entry", `?ids=${crypto.randomUUID()},`],
  ["a malformed id", `?ids=${crypto.randomUUID()},not-a-media-id`],
  [
    "more than fifty ids",
    `?ids=${Array.from({ length: 51 }, () => crypto.randomUUID()).join(",")}`,
  ],
])(
  "the batch target read answers %s with the typed 400",
  async (_name, query) => {
    const { app, read } = batchApp();
    const response = await app.request(`${url}${query}`, { headers });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_input" },
    });
    expect(read).not.toHaveBeenCalled();
  },
);

test("the batch target read passes distinct ids in request order and never dispatches the outbox", async () => {
  const { app, read, afterWrite } = batchApp();
  const ids = Array.from({ length: 50 }, () => crypto.randomUUID());
  const [first = "", second = ""] = ids;
  const response = await app.request(`${url}?ids=${ids.join(",")}`, {
    headers,
  });
  expect(response.status).toBe(200);
  expect(read).toHaveBeenLastCalledWith(actor, ids);
  expect(await response.json()).toMatchObject({
    schemaVersion: 2,
    items: ids.map((mediaId) => ({ status: "unavailable", mediaId })),
  });
  await app.request(`${url}?ids=${[second, first, second].join(",")}`, {
    headers,
  });
  expect(read).toHaveBeenLastCalledWith(actor, [second, first]);
  expect(afterWrite).not.toHaveBeenCalled();
});
