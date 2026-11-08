import { expect, test } from "vitest";
import { DatabaseProviderRegistry } from "#automation/providers.ts";
import { IntegrationError } from "#integrations/http.ts";
import { automationTestHarness } from "#testing/automation.ts";

const h = automationTestHarness();

async function fixture() {
  const db = h.database();
  const credential = await db.credential.create({
    data: {
      kind: "provider:privatehd",
      ciphertext: authentication("first"),
    },
  });
  await db.mediaProvider.upsert({
    where: { id: "privatehd" },
    create: { id: "privatehd", enabled: true, credentialId: credential.id },
    update: {
      enabled: true,
      credentialId: credential.id,
      configuration: {},
      lastError: null,
    },
  });
  await db.providerLease.deleteMany({ where: { providerId: "privatehd" } });
  return { db, credential };
}

function authentication(password: string) {
  return h.cipher.encrypt(
    JSON.stringify({ username: "synthetic", password, pid: "synthetic" }),
    "provider:privatehd",
  );
}

async function elapsed() {
  await h.database().providerLease.update({
    where: { providerId: "privatehd" },
    data: { nextAllowedAt: new Date(Date.now() - 1) },
  });
}

function recent(registry: DatabaseProviderRegistry) {
  return registry.withProvider("privatehd", (client) => {
    if (client.recent === undefined)
      throw new Error("Private provider is missing its recent reader");
    return client.recent({ page: 1 });
  });
}

test("default pacing defers after login and reuses only the token across fresh leases", async () => {
  const { db } = await fixture();
  const calls: string[] = [];
  const owners: string[] = [];
  const registry = new DatabaseProviderRegistry(db, h.cipher, async (url) => {
    calls.push(url.pathname);
    const lease = await db.providerLease.findUniqueOrThrow({
      where: { providerId: "privatehd" },
    });
    if (lease.ownerId === null) throw new Error("Request has no lease owner");
    owners.push(lease.ownerId);
    return url.pathname.endsWith("/auth")
      ? Response.json({ token: "synthetic-session" })
      : Response.json({ data: [] });
  });
  await expect(recent(registry)).rejects.toMatchObject({
    kind: "rate-limited",
    retryAfterSeconds: 30,
  });
  expect(calls).toEqual(["/api/v1/jackett/auth"]);
  const deferred = await db.providerLease.findUniqueOrThrow({
    where: { providerId: "privatehd" },
  });
  expect(deferred.ownerId).toBeNull();
  expect(deferred.leaseUntil).toBeNull();
  expect(deferred.nextAllowedAt.getTime()).toBeGreaterThan(Date.now());
  await elapsed();
  await expect(recent(registry)).resolves.toEqual({
    candidates: [],
    scanned: 0,
    nextPage: null,
  });
  await elapsed();
  await recent(registry);
  expect(calls).toEqual([
    "/api/v1/jackett/auth",
    "/api/v1/jackett/torrents",
    "/api/v1/jackett/torrents",
  ]);
  expect(new Set(owners).size).toBe(3);
  expect(
    await db.mediaProvider.findUniqueOrThrow({ where: { id: "privatehd" } }),
  ).toMatchObject({ lastError: null });
});

test("credential rotation and rejected tokens require a new paced login", async () => {
  const { db, credential } = await fixture();
  let logins = 0;
  let rejectToken = false;
  const tokens: (string | null)[] = [];
  const registry = new DatabaseProviderRegistry(db, h.cipher, (url, init) => {
    if (url.pathname.endsWith("/auth")) {
      logins++;
      return Promise.resolve(
        Response.json({ token: `synthetic-${String(logins)}` }),
      );
    }
    tokens.push(new Headers(init.headers).get("authorization"));
    return Promise.resolve(
      rejectToken
        ? new Response(null, { status: 401 })
        : Response.json({ data: [] }),
    );
  });
  await expect(recent(registry)).rejects.toMatchObject({
    kind: "rate-limited",
  });
  await elapsed();
  await recent(registry);
  await db.credential.update({
    where: { id: credential.id },
    data: { ciphertext: authentication("rotated") },
  });
  await elapsed();
  await expect(recent(registry)).rejects.toMatchObject({
    kind: "rate-limited",
  });
  expect(logins).toBe(2);
  await elapsed();
  rejectToken = true;
  await expect(recent(registry)).rejects.toMatchObject({
    kind: "authentication",
  });
  await elapsed();
  rejectToken = false;
  await expect(recent(registry)).rejects.toMatchObject({
    kind: "rate-limited",
  });
  expect(logins).toBe(3);
  await elapsed();
  await recent(registry);
  expect(tokens).toEqual([
    "Bearer synthetic-1",
    "Bearer synthetic-2",
    "Bearer synthetic-3",
  ]);
});

test("an active provider lease blocks another registry before any authentication", async () => {
  const { db } = await fixture();
  await db.providerLease.create({
    data: {
      providerId: "privatehd",
      ownerId: "another-worker",
      leaseUntil: new Date(Date.now() + 60_000),
      nextAllowedAt: new Date(Date.now() - 1),
    },
  });
  const registry = new DatabaseProviderRegistry(db, h.cipher, () => {
    throw new Error("A contending worker must not issue HTTP requests");
  });
  await expect(recent(registry)).rejects.toBeInstanceOf(IntegrationError);
  expect(
    await db.providerLease.findUniqueOrThrow({
      where: { providerId: "privatehd" },
    }),
  ).toMatchObject({ ownerId: "another-worker" });
});
