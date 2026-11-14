import {
  actor,
  fixture,
  headers,
  handoffFixture,
} from "./http.test-support.ts";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createMediaApp, type MediaAppDependencies } from "./app.ts";

import { verifyPlexEventHttp } from "./plex-events/http.test-support.ts";
import { verifyExternalLibraryHttp } from "./external-library-http.test-support.ts";

test("external library owner API retains session, origin and CSRF gates", async () => {
  await verifyExternalLibraryHttp(fixture().dependencies, headers);
});

test("capacity route is registered behind normal session authentication", async () => {
  const { dependencies } = fixture();
  const app = createMediaApp(dependencies);
  const denied = await app.request("/api/v1/admin/capacity");
  expect(denied.status).toBe(401);
  const response = await app.request("/api/v1/admin/capacity", { headers });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    schemaVersion: 1,
    samplingEnabled: false,
  });
});

test("runtime changes require a session, CSRF, idempotency, and a reviewed version", async () => {
  const { dependencies } = fixture();
  const setRuntime = vi.fn(dependencies.admin.setRuntime);
  dependencies.admin = { ...dependencies.admin, setRuntime };
  const app = createMediaApp(dependencies);
  const url = "/api/v1/admin/runtime";
  const unauthenticated = await app.request(url);
  expect(unauthenticated.status).toBe(401);
  const body = JSON.stringify({ mode: "active", expectedVersion: 0 });
  const csrfRejected = await app.request(url, {
    method: "PUT",
    headers: { ...headers, "X-CSRF-Token": "wrong" },
    body,
  });
  expect(csrfRejected.status).toBe(403);
  const invalid = await app.request(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({ mode: "active" }),
  });
  expect(invalid.status).toBe(400);
  expect(setRuntime).not.toHaveBeenCalled();
  const response = await app.request(url, { method: "PUT", headers, body });
  expect(response.status).toBe(200);
  expect(setRuntime).toHaveBeenCalledExactlyOnceWith(actor, "request-key", {
    mode: "active",
    expectedVersion: 0,
  });
});

test("Plex hints authenticate before body reads and sanitize all event errors", async () => {
  await verifyPlexEventHttp(fixture().dependencies);
});

describe("media HTTP security and errors", () => {
  test("recovery declarations use current authenticated identity and enforce CSRF before service calls", async () => {
    const { dependencies } = fixture();
    const respond = vi.fn<MediaAppDependencies["recoveryAdmin"]["respond"]>(
      async () => ({ status: "completed" }),
    );
    dependencies.recoveryAdmin = { ...dependencies.recoveryAdmin, respond };
    const app = createMediaApp(dependencies);
    const id = crypto.randomUUID();
    const input = {
      scopeHash: "a".repeat(64),
      acknowledgePending: true,
      declarations: [{ mediaId: crypto.randomUUID(), intent: "request" }],
    };
    const rejected = await app.request(
      `/api/v1/recovery/reviews/${id}/responses`,
      {
        method: "POST",
        headers: { ...headers, "X-CSRF-Token": "wrong" },
        body: JSON.stringify(input),
      },
    );
    expect(rejected.status).toBe(403);
    expect(respond).not.toHaveBeenCalled();
    const accepted = await app.request(
      `/api/v1/recovery/reviews/${id}/responses`,
      { method: "POST", headers, body: JSON.stringify(input) },
    );
    expect(accepted.status).toBe(200);
    expect(respond).toHaveBeenCalledWith(
      actor,
      headers["Idempotency-Key"],
      id,
      input,
    );
  });
  test("handoff apply forwards the authenticated actor and exact reviewed hash; malformed scope is rejected", async () => {
    const { dependencies } = fixture();
    const apply = vi.fn<MediaAppDependencies["handoffAdmin"]["apply"]>(
      async () => ({ status: "queued", operationId: crypto.randomUUID() }),
    );
    dependencies.handoffAdmin = { ...handoffFixture, apply };
    const app = createMediaApp(dependencies);
    const id = crypto.randomUUID();
    const input = {
      expectedVersion: 2,
      planHash: "a".repeat(64),
      recoveryEpoch: 3,
      runtimeVersion: 4,
      acknowledgeProtectedLegacySources: true,
      acknowledgeRecoveryHolds: true,
    };
    const response = await app.request(`/api/v1/admin/handoffs/${id}/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(202);
    expect(apply).toHaveBeenCalledWith(
      actor,
      headers["Idempotency-Key"],
      id,
      input,
    );
    const invalid = await app.request(`/api/v1/admin/handoffs/${id}/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...input, acknowledgeRecoveryHolds: false }),
    });
    expect(invalid.status).toBe(400);
    expect(apply).toHaveBeenCalledOnce();
  });
  test("only manual subtitle upload accepts a body larger than the normal API limit", async () => {
    const { dependencies } = fixture();
    const app = createMediaApp(dependencies);
    const contentBase64 = Buffer.from(
      "subtitle fixture\n".repeat(5000),
    ).toString("base64");
    const upload = await app.request("/api/v1/admin/subtitles", {
      method: "POST",
      headers,
      body: JSON.stringify({
        assetId: "00000000-0000-4000-8000-000000000001",
        expectedAssetVersion: 0,
        expectedChecksum: "a".repeat(64),
        language: "en",
        filename: "fixture.srt",
        description: "Human translation",
        contentBase64,
        confirmedMatchingVideo: true,
      }),
    });
    expect(upload.status).toBe(202);
    const ordinary = await app.request("/api/v1/requests", {
      method: "POST",
      headers,
      body: JSON.stringify({ mediaId: contentBase64 }),
    });
    expect(ordinary.status).toBe(413);
  });
  test("anonymous access is denied and health remains public", async () => {
    const { dependencies } = fixture();
    const app = createMediaApp(dependencies);
    const health = await app.request("/health");
    const denied = await app.request("/api/v1/requests");
    expect(health.status).toBe(200);
    expect(denied.status).toBe(401);
  });

  test("cross-origin requests and missing CSRF never reach commands", async () => {
    const { dependencies, createRequest } = fixture();
    const app = createMediaApp(dependencies);
    const foreign = await app.request("/api/v1/requests", {
      method: "POST",
      headers: { ...headers, Origin: "https://attacker.example" },
      body: JSON.stringify({ mediaId: "media" }),
    });
    const missingCsrf = await app.request("/api/v1/requests", {
      method: "POST",
      headers: { ...headers, "X-CSRF-Token": "wrong" },
      body: JSON.stringify({ mediaId: "media" }),
    });
    expect(foreign.status).toBe(403);
    expect(missingCsrf.status).toBe(403);
    expect(createRequest).not.toHaveBeenCalled();
  });

  test("request identity comes from the session and body cannot impersonate another user", async () => {
    const { dependencies, createRequest } = fixture();
    const app = createMediaApp(dependencies);
    const rejected = await app.request("/api/v1/requests", {
      method: "POST",
      headers,
      body: JSON.stringify({ mediaId: "media", userId: "owner" }),
    });
    expect(rejected.status).toBe(400);
    const accepted = await app.request("/api/v1/requests", {
      method: "POST",
      headers,
      body: JSON.stringify({ mediaId: "media" }),
    });
    expect(accepted.status).toBe(202);
    expect(createRequest.mock.calls[0]?.[0]).toEqual(actor);
  });

  test("Keep remains available while new requests are gated off", async () => {
    const { dependencies, act } = fixture();
    dependencies.requestsEnabled = async () => false;
    const app = createMediaApp(dependencies);
    const request = await app.request("/api/v1/requests", {
      method: "POST",
      headers,
      body: JSON.stringify({ mediaId: "media" }),
    });
    const keep = await app.request("/api/v1/media/media/actions", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "keep", expectedVersion: 0 }),
    });
    expect(request.status).toBe(503);
    expect(keep.status).toBe(202);
    expect(act).toHaveBeenCalledOnce();
  });

  test("invalid inbound JSON returns400, corrupt internal data returns500", async () => {
    const { dependencies } = fixture();
    dependencies.media.profiles = async () => {
      z.string().parse(123);
      return [];
    };
    const app = createMediaApp(dependencies);
    const invalid = await app.request("/api/v1/requests", {
      method: "POST",
      headers,
      body: "{",
    });
    expect(invalid.status).toBe(400);
    const response = await app.request("/api/v1/profiles", { headers });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("123");
    expect(dependencies.onError).toHaveBeenCalledOnce();
  });

  test("Plex login sets secure session cookies without exposing credentials", async () => {
    const { dependencies } = fixture();
    const app = createMediaApp(dependencies);
    const response = await app.request("/api/v1/auth/plex/poll/login", {
      method: "POST",
      headers: {
        Origin: headers.Origin,
        Cookie: "__Host-media-login=browser-token",
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
    expect(await response.text()).not.toContain("session-token");
  });
});
