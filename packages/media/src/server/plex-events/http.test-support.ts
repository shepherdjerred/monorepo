import { expect, vi } from "vitest";
import { createMediaApp, type MediaAppDependencies } from "#server/app.ts";

const secret = "synthetic-webhook-capability-0123456789";
const raw = {
  event: "media.scrobble",
  Server: { uuid: "fixture-server" },
  Metadata: { type: "movie", librarySectionID: 1, ratingKey: "123" },
  Account: { id: 1, title: "Private account" },
};
function form(payload: unknown = raw) {
  const body = new FormData();
  body.set("payload", JSON.stringify(payload));
  body.set(
    "thumb",
    new Blob([new Uint8Array(70_000)], { type: "image/jpeg" }),
    "poster.jpg",
  );
  return body;
}

export async function verifyPlexEventHttp(dependencies: MediaAppDependencies) {
  const accept = vi.fn(() => Promise.resolve());
  const onError = vi.fn<MediaAppDependencies["onError"]>();
  const enabled = vi.fn(() => Promise.resolve(true));
  const app = createMediaApp({
    ...dependencies,
    onError,
    plexEvents: { secret, enabled, ingress: { accept } },
  });
  const url = `http://localhost/events/plex?key=${secret}`;
  const response = await app.request(url, { method: "POST", body: form() });
  expect(response.status).toBe(200);
  expect(accept).toHaveBeenCalledExactlyOnceWith({
    schemaVersion: 1,
    event: "media.scrobble",
    serverMachineId: "fixture-server",
    sectionId: "1",
    ratingKey: "123",
    mediaKind: "movie",
  });
  expect(JSON.stringify([...response.headers])).not.toContain(secret);
  expect(await response.text()).not.toContain(secret);

  for (const query of [
    "",
    "?key=wrong",
    `?key=${secret}&key=${secret}`,
    `?key=${"x".repeat(257)}`,
  ]) {
    let pulled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled = true;
          throw new Error(url);
        },
      },
      { highWaterMark: 0 },
    );
    const denied = await app.request(
      new Request(`http://localhost/events/plex${query}`, {
        method: "POST",
        body,
      }),
    );
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "Unauthorized" });
    expect(pulled).toBe(false);
  }
  enabled.mockResolvedValue(false);
  const disabled = await app.request(url, { method: "POST", body: form() });
  expect(disabled.status).toBe(503);
  expect(accept).toHaveBeenCalledTimes(1);
  enabled.mockResolvedValue(true);
  const absent = createMediaApp({
    ...dependencies,
    plexEvents: { secret: undefined, enabled, ingress: { accept } },
  });
  const unconfigured = await absent.request(url, {
    method: "POST",
    body: form(),
  });
  expect(unconfigured.status).toBe(503);

  const duplicate = form();
  duplicate.append("payload", JSON.stringify(raw));
  const extra = form();
  extra.append("other", "discard");
  const oversizedPayload = form({ ...raw, ignored: "x".repeat(65_536) });
  for (const [body, status] of [
    [duplicate, 400],
    [extra, 400],
    [oversizedPayload, 413],
  ] as const) {
    const rejected = await app.request(url, { method: "POST", body });
    expect(rejected.status).toBe(status);
  }
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
      controller.close();
    },
  });
  const capped = await app.request(
    new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=test",
        "Content-Length": "1",
      },
      body: oversized,
    }),
  );
  expect(capped.status).toBe(413);
  const unsupported = await app.request(url, {
    method: "POST",
    body: form({ ...raw, event: "library.new" }),
  });
  expect(unsupported.status).toBe(200);
  expect(accept).toHaveBeenCalledTimes(1);
  const unsafe = await app.request(url, {
    method: "POST",
    body: form({
      ...raw,
      Metadata: { ...raw.Metadata, ratingKey: Number.MAX_SAFE_INTEGER + 1 },
    }),
  });
  expect(unsafe.status).toBe(400);

  const encoded = `http://localhost/events/plex?key=${Array.from(new TextEncoder().encode(secret), (byte) => `%${byte.toString(16)}`).join("")}`;
  accept.mockRejectedValue(
    new Error(`Database failed for ${url}`, { cause: new Error(secret) }),
  );
  const failed = await app.request(encoded, { method: "POST", body: form() });
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain(secret);
  expect(onError).toHaveBeenCalledExactlyOnceWith(
    expect.any(Error),
    expect.any(String),
  );
  const error = onError.mock.calls[0]?.[0];
  if (error === undefined) throw new Error("Missing sanitized callback");
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toBe("Error: Plex event processing failed");
  expect(error.cause).toBeUndefined();
  expect(error.stack).not.toContain(secret);
  const dispatchError = vi.fn<MediaAppDependencies["onError"]>();
  const dispatch = createMediaApp({
    ...dependencies,
    onError: dispatchError,
    afterWrite: () => Promise.reject(new Error(url)),
    plexEvents: {
      secret,
      enabled,
      ingress: { accept: () => Promise.resolve() },
    },
  });
  const committed = await dispatch.request(url, {
    method: "POST",
    body: form(),
  });
  expect(committed.status).toBe(200);
  await vi.waitFor(() => {
    expect(dispatchError).toHaveBeenCalledTimes(1);
  });
  expect(String(dispatchError.mock.calls[0]?.[0])).toBe(
    "Error: Outbox dispatch deferred",
  );
}
