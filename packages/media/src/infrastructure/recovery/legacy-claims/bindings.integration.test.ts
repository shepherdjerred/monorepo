import { expect, test } from "vitest";
import { Hono } from "hono";
import type { MediaActor } from "#application/auth.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { registerLegacyRequesterBindingRoutes } from "#server/legacy-requester-binding-routes.ts";
import { MediaError } from "#application/errors.ts";
import { legacyClaimsHarness } from "./test-fixture.ts";
const harness = legacyClaimsHarness();

test("owner-only HTTP listing never exposes requester evidence to a signed-in member", async () => {
  const f = await harness.setup();
  const source = await f.capture();
  const app = new Hono<{
    Variables: { actor: MediaActor; requestId: string };
  }>();
  let currentActor: MediaActor = f.subject;
  app.use("*", async (c, next) => {
    c.set("actor", currentActor);
    await next();
  });
  app.onError((error, c) =>
    c.json(
      { error: error instanceof MediaError ? error.code : "unexpected" },
      403,
    ),
  );
  registerLegacyRequesterBindingRoutes(app, f.service);
  const response = await app.request(
    `/api/v1/admin/legacy-requester-bindings?captureId=${source.captureId}`,
  );
  expect(response.status).toBe(403);
  expect(await response.text()).toBe('{"error":"owner_required"}');
  currentActor = f.owner;
  const ownerResponse = await app.request(
    `/api/v1/admin/legacy-requester-bindings?captureId=${source.captureId}`,
  );
  expect(ownerResponse.status).toBe(200);
  const ownerView = await f.service.list(f.owner, source.captureId);
  const requester = ownerView.requesters[0];
  if (requester === undefined) throw new Error("Fixture requester missing");
  const created = await app.request("/api/v1/admin/legacy-requester-bindings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      captureId: source.captureId,
      requesterSourceId: requester.requesterSourceId,
      requesterEvidenceHash: requester.requesterEvidenceHash,
      userId: f.subject.id,
      expectedRevision: 0,
      acknowledgeIdentityOnly: true,
    }),
  });
  expect(created.status).toBe(200);
  await expect(
    f.service.list({ ...f.owner, role: "member" }, source.captureId),
  ).resolves.toMatchObject({ captureId: source.captureId });
  await f.db.mediaUser.update({
    where: { id: f.owner.id },
    data: { role: "member" },
  });
  await expect(f.service.list(f.owner, source.captureId)).rejects.toMatchObject(
    { code: "owner_required" },
  );
});

test("concurrent declarations of one source tuple append exactly one immutable revision", async () => {
  const f = await harness.setup();
  const source = await f.capture();
  const results = await Promise.allSettled([
    f.bind(source.captureId, f.subject.id, 0),
    f.bind(source.captureId, f.subject.id, 0),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  expect(
    await f.db.legacyRequesterBinding.count({
      where: { captureId: source.captureId },
    }),
  ).toBe(1);
});

test("recycled requester IDs bind each capture's person and invalidate pending projection without reassigning earlier claims", async () => {
  const f = await harness.setup();
  const first = await f.capture();
  await f.bind(first.captureId);
  const original = await f.project([f.movie.id]);
  const nextPerson = await f.db.mediaUser.create({
    data: {
      plexAccountId: String(crypto.getRandomValues(new Uint32Array(1))[0]),
      displayName: "Different known person",
    },
  });
  await grantTestRequesterAccess(f.db, nextPerson.id, "binding-fixture-server");
  const later = await f.capture();
  await f.bind(later.captureId, nextPerson.id);
  const next = await f.project([f.movie.id]);
  expect(snapshotHash(next.claims)).not.toBe(snapshotHash(original.claims));
  expect(
    next.claims.find((claim) => claim.captureId === first.captureId),
  ).toMatchObject({
    userId: f.subject.id,
    bindingRevision: 1,
    latestBindingRevision: 2,
  });
  expect(
    next.claims.find((claim) => claim.captureId === later.captureId),
  ).toMatchObject({ userId: nextPerson.id, bindingRevision: 2 });
  await f.account(original.claims);
  const remaining = await f.project([f.movie.id]);
  expect(remaining.claims).toHaveLength(1);
  expect(remaining.claims[0]?.captureId).toBe(later.captureId);
});

test("unverified ordinary subjects cannot be invented by a source numeric ID or display name", async () => {
  const f = await harness.setup();
  const source = await f.capture();
  const unknown = await f.db.mediaUser.create({
    data: { plexAccountId: "7", displayName: f.subject.displayName },
  });
  await expect(f.bind(source.captureId, unknown.id)).rejects.toMatchObject({
    code: "legacy_requester_binding_changed",
  });
  expect(
    await f.db.legacyRequesterBinding.count({
      where: { captureId: source.captureId },
    }),
  ).toBe(0);
});

test("exact mapped Home subject can be associated but the binding creates no request", async () => {
  const f = await harness.setup();
  const source = await f.capture();
  const managed = await f.db.mediaUser.create({
    data: {
      plexAccountId: `managed:${crypto.randomUUID()}`,
      displayName: "Managed subject",
      plexIdentity: {
        create: {
          kind: "managed",
          serverMachineId: "binding-fixture-server",
          serverAccountId: "fixture-local-managed",
          homeUserId: "fixture-home-managed",
          verifiedAt: new Date(),
          plexRestricted: true,
          permittedSectionIds: ["1"],
          permittedMediaKinds: ["movie"],
        },
      },
    },
  });
  await f.bind(source.captureId, managed.id);
  const projected = await f.project([f.movie.id]);
  expect(projected.claims[0]?.userId).toBe(managed.id);
  expect(await f.db.mediaRequest.count({ where: { userId: managed.id } })).toBe(
    0,
  );
});

test("captured requester evidence must match exactly and no failed mapping changes the capture", async () => {
  const f = await harness.setup();
  const source = await f.capture();
  await expect(
    f.service.bind(f.owner, crypto.randomUUID(), {
      captureId: source.captureId,
      requesterSourceId: "7",
      requesterEvidenceHash: "a".repeat(64),
      userId: f.subject.id,
      expectedRevision: 0,
      acknowledgeIdentityOnly: true,
    }),
  ).rejects.toMatchObject({ code: "legacy_requester_binding_changed" });
  const capture = await f.db.migrationCapture.findUniqueOrThrow({
    where: { id: source.captureId },
  });
  expect(capture.manifest).toMatchObject({ records: [source.request] });
});
