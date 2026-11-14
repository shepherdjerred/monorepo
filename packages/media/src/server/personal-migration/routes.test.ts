import { expect, test } from "vitest";
import { Hono } from "hono";
import type { MediaActor } from "#application/auth.ts";
import { registerPersonalMigrationRoutes } from "./routes.ts";

test("personal migration routes pass validated owner selection, exact hash and idempotency key", async () => {
  const actor: MediaActor = {
    id: crypto.randomUUID(),
    plexAccountId: "7",
    role: "owner",
    restricted: false,
    version: 0,
    displayName: "Owner",
  };
  const app = new Hono<{
    Variables: { actor: MediaActor; requestId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    await next();
  });
  const selection = {
    captureIds: [crypto.randomUUID()],
    movieEditions: [],
    historyOnly: [],
  };
  const key = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const calls: unknown[] = [];
  registerPersonalMigrationRoutes(app, {
    preview: async (current, input) => {
      calls.push({ current, input });
      return {
        schemaVersion: 1,
        captures: [],
        claims: [],
        library: [],
        stateHash: "a".repeat(64),
        monitoring: [],
        subtitlePolicies: [],
        blocked: false,
        libraryKeepingPolicy: "keep",
        importedClaimKeepingPolicy: "temporary",
        importedClaimInterest: "following",
        transfersTorrentOwnership: false,
        changesPlaybackState: false,
        previewHash: "b".repeat(64),
      };
    },
    apply: async (current, actualKey, input) => {
      calls.push({ current, key: actualKey, input });
      return { status: "completed", version: 1, eventId, next: null };
    },
    imported: async () => [],
    passive: async () => [],
    reconcile: async (current, actualKey, input) => {
      calls.push({ current, key: actualKey, input });
      return { status: "completed", version: 1, released: 0, next: null };
    },
  });
  const imported = await app.request("/api/v1/requests/imported");
  expect(imported.status).toBe(200);
  const passive = await app.request(
    `/api/v1/admin/migration/personal/passive?${new URLSearchParams({ bundleReviewId: crypto.randomUUID(), bundleReviewVersion: "0", provenanceKey: "a".repeat(64) }).toString()}`,
  );
  expect(passive.status).toBe(200);
  const preview = await app.request(
    "/api/v1/admin/migration/personal/preview",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selection),
    },
  );
  expect(preview.status).toBe(200);
  const input = {
    ...selection,
    previewHash: "a".repeat(64),
    acknowledgeExistingLibraryKeep: true,
    acknowledgeTemporaryFollowingClaims: true,
  };
  const applied = await app.request("/api/v1/admin/migration/personal/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(input),
  });
  expect(applied.status).toBe(200);
  const reconciliation = { eventId, after: null };
  const reconciled = await app.request(
    "/api/v1/admin/migration/personal/reconcile",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(reconciliation),
    },
  );
  expect(reconciled.status).toBe(200);
  expect(calls).toEqual([
    { current: actor, input: selection },
    { current: actor, key, input },
    { current: actor, key, input: reconciliation },
  ]);
});
