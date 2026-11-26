import {
  actor,
  fixture,
  headers,
  handoffFixture,
} from "./http.test-support.ts";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createMediaApp, type MediaAppDependencies } from "./app.ts";
import type { RequestInterestApplication } from "./household/interests.ts";
import { TmdbCatalogApplication } from "#infrastructure/catalog.ts";
import type { PrismaLibraryApplication } from "#infrastructure/library/views/library.ts";
import { createDatabase } from "#infrastructure/database.ts";
import { TmdbClient } from "#integrations/tmdb.ts";

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

test("imported activity uses the authenticated activity and migration endpoints", async () => {
  const { dependencies } = fixture();
  const memberApp = createMediaApp(dependencies);
  const activity = "/api/v1/activity?source=sonarr";
  const signedOut = await memberApp.request(activity);
  expect(signedOut.status).toBe(401);
  const memberDenied = await memberApp.request(activity, { headers });
  expect(memberDenied.status).toBe(403);
  const ordinary = await memberApp.request("/api/v1/activity", { headers });
  expect(await ordinary.json()).toEqual([]);

  const { dependencies: ownerDependencies } = fixture();
  const session = ownerDependencies.auth.authenticate;
  ownerDependencies.auth.authenticate = async (token) => {
    const current = await session(token);
    return { ...current, actor: { ...current.actor, role: "owner" } };
  };
  const ownerApp = createMediaApp(ownerDependencies);
  const filtered = await ownerApp.request(activity, { headers });
  expect(filtered.status).toBe(200);
  expect(await filtered.json()).toEqual({ items: [], nextCursor: null });
  const invalid = await ownerApp.request("/api/v1/activity?source=unknown", {
    headers,
  });
  expect(invalid.status).toBe(400);

  const url = "/api/v1/admin/migration";
  const body = JSON.stringify({
    kind: "legacy_activity",
    events: [
      {
        source: "radarr",
        sourceInstanceId: "31b72d44-11fc-4411-9bc8-6304a2c588a4",
        table: "history",
        originalId: 1,
        sourceDate: "2026-09-28T22:18:01Z",
        action: "grabbed",
        actionCode: null,
        fileId: null,
        movieId: 50,
        qualityId: null,
        customFormatScore: null,
        provider: null,
      },
    ],
  });
  const memberWrite = await memberApp.request(url, {
    method: "POST",
    headers,
    body,
  });
  expect(memberWrite.status).toBe(403);
  const denied = await ownerApp.request(url, {
    method: "POST",
    headers: { ...headers, "X-CSRF-Token": "wrong" },
    body,
  });
  expect(denied.status).toBe(403);
  const imported = await ownerApp.request(url, {
    method: "POST",
    headers,
    body,
  });
  expect(imported.status).toBe(200);
  expect(await imported.json()).toEqual({ imported: 1, unchanged: 0 });
});

function unusedInterestRead() {
  return Promise.reject(new Error("Unused interest fixture"));
}

test("request interests add artwork only on an explicit include and refuse an unknown one", async () => {
  const { dependencies } = fixture();
  const list = vi.fn<RequestInterestApplication["list"]>(() =>
    Promise.resolve({ items: [], nextCursor: null }),
  );
  dependencies.requestInterests = {
    list,
    progress: unusedInterestRead,
    execute: unusedInterestRead,
    libraryPolicy: unusedInterestRead,
  };
  const app = createMediaApp(dependencies);
  const url = "/api/v1/request-interests";
  // An earlier client never sends the parameter and must keep its strict rows.
  const plain = await app.request(url, { headers });
  expect(plain.status).toBe(200);
  expect(list).toHaveBeenLastCalledWith(actor, null, { artwork: false });
  const requested = await app.request(`${url}?include=artwork`, { headers });
  expect(requested.status).toBe(200);
  expect(list).toHaveBeenLastCalledWith(actor, null, { artwork: true });
  const unknown = await app.request(`${url}?include=progress`, { headers });
  expect(unknown.status).toBe(400);
  expect(list).toHaveBeenCalledTimes(2);
});

test("library passes its sort and filters through and answers 400 for an unknown value or another sort's cursor", async () => {
  const { dependencies } = fixture();
  const list = vi.fn<PrismaLibraryApplication["list"]>(() =>
    Promise.resolve({ items: [], nextCursor: null }),
  );
  dependencies.library = { list };
  const app = createMediaApp(dependencies);
  const read = (query: string) =>
    app.request(`/api/v1/library${query}`, { headers });
  const status = async (query: string) => {
    const response = await read(query);
    return response.status;
  };
  const everything = {
    query: "",
    kind: "all",
    sort: "title",
    policy: "all",
    mine: "all",
    leaving: "all",
    availability: "all",
    cursor: null,
    limit: 25,
  };
  // An earlier client sends only `query`, `kind` and its title cursor.
  expect(await status("?query=&kind=all")).toBe(200);
  expect(list).toHaveBeenLastCalledWith(actor, everything);
  const titleCursor = JSON.stringify({ title: "Dune", id: "media-1" });
  const addedCursor = JSON.stringify({
    addedAt: "2026-11-01T12:00:00.000Z",
    id: "media-1",
  });
  const filtered = `?sort=added&policy=temporary&mine=following&leaving=soon&availability=available&cursor=${encodeURIComponent(addedCursor)}`;
  expect(await status(filtered)).toBe(200);
  expect(list).toHaveBeenLastCalledWith(actor, {
    ...everything,
    sort: "added",
    policy: "temporary",
    mine: "following",
    leaving: "soon",
    availability: "available",
    cursor: addedCursor,
  });
  for (const query of [
    "?sort=newest",
    "?policy=kept",
    "?mine=me",
    "?leaving=later",
    "?availability=maybe",
    `?sort=added&cursor=${encodeURIComponent(titleCursor)}`,
    `?sort=title&cursor=${encodeURIComponent(addedCursor)}`,
    `?cursor=${encodeURIComponent(addedCursor)}`,
    "?sort=added&cursor=not-json",
  ]) {
    const refused = await read(query);
    expect(refused.status, query).toBe(400);
    expect(await refused.json(), query).toMatchObject({
      error: { code: "invalid_input" },
    });
  }
  expect(list).toHaveBeenCalledTimes(2);
});

test("catalog search and discover pass the session actor and refuse an unknown feed or a page outside 1 to 5", async () => {
  const { dependencies } = fixture();
  const search = vi.fn(dependencies.catalog.search);
  const discover = vi.fn(dependencies.catalog.discover);
  dependencies.catalog = { ...dependencies.catalog, search, discover };
  const app = createMediaApp(dependencies);
  const signedIn = { headers };
  const status = async (path: string, init: RequestInit = signedIn) => {
    const response = await app.request(`/api/v1/catalog/${path}`, init);
    return response.status;
  };
  expect(await status("search?q=dune")).toBe(200);
  expect(search).toHaveBeenLastCalledWith(actor, "dune", 1);
  expect(await status("search?q=dune&page=5")).toBe(200);
  expect(search).toHaveBeenLastCalledWith(actor, "dune", 5);
  for (const page of ["0", "6", "1.5", "two", ""])
    expect(await status(`search?q=dune&page=${page}`), page).toBe(400);
  expect(search).toHaveBeenCalledTimes(2);
  expect(await status("discover?feed=trending")).toBe(200);
  expect(discover).toHaveBeenLastCalledWith(actor, "trending", 1);
  expect(await status("discover?feed=on_the_air&page=5")).toBe(200);
  expect(discover).toHaveBeenLastCalledWith(actor, "on_the_air", 5);
  for (const query of [
    "",
    "feed=popular",
    "feed=trending&page=0",
    "feed=trending&page=6",
  ])
    expect(await status(`discover?${query}`), query).toBe(400);
  expect(discover).toHaveBeenCalledTimes(2);
  expect(await status("discover?feed=trending", {})).toBe(401);
});

test("a catalog that does not answer is a typed 502, not an internal error", async () => {
  const { dependencies } = fixture();
  dependencies.catalog = new TmdbCatalogApplication(
    createDatabase("postgres://unused@127.0.0.1:1/unused"),
    new TmdbClient({ kind: "bearer", token: "fixture-token" }, () =>
      Promise.resolve(new Response("provider body", { status: 503 })),
    ),
  );
  const app = createMediaApp(dependencies);
  for (const path of ["search?q=dune", "discover?feed=trending", "movie/11"]) {
    const response = await app.request(`/api/v1/catalog/${path}`, { headers });
    expect(response.status, path).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: "catalog_unavailable",
        message:
          "The catalog is not answering right now. Try again in a moment.",
      },
    });
  }
  expect(dependencies.onError).not.toHaveBeenCalled();
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
});

test("Plex login attempts Seerr attachment and still sets secure cookies when attachment needs a retry", async () => {
  const { dependencies } = fixture();
  const attachImportedRequests = vi.fn(() =>
    Promise.reject(new Error("Synthetic attachment failure")),
  );
  dependencies.migrationAdmin.personal = {
    apply: unusedInterestRead,
    passive: unusedInterestRead,
    preview: unusedInterestRead,
    reconcile: unusedInterestRead,
    imported: unusedInterestRead,
    importedHistory: unusedInterestRead,
    attachImportedRequests,
  };
  const app = createMediaApp(dependencies);
  const response = await app.request("/api/v1/auth/plex/poll/login", {
    method: "POST",
    headers: {
      Origin: headers.Origin,
      Cookie: "__Host-media-login=browser-token",
    },
  });
  expect(response.status).toBe(200);
  expect(attachImportedRequests).toHaveBeenCalledExactlyOnceWith(actor);
  expect(dependencies.onError).toHaveBeenCalledOnce();
  expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
  expect(response.headers.get("Set-Cookie")).toContain("Secure");
  expect(await response.text()).not.toContain("session-token");
});
