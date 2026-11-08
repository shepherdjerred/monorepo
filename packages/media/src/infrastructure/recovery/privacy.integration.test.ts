import { expect, test } from "vitest";
import { Hono } from "hono";
import { MediaError } from "#application/errors.ts";
import type { MediaActor } from "#application/auth.ts";
import { registerRecoveryRoutes } from "#server/recovery-routes.ts";
import { recoveryHarness } from "./test-support.ts";

const { fixture } = recoveryHarness();
test("HTTP member reads redact other household evidence and deny revoked libraries and proxy declarations", async () => {
  const f = await fixture();
  const review = await f.prepare();
  await f.service.respond(f.owner, crypto.randomUUID(), review.id, {
    scopeHash: review.scopeHash,
    acknowledgePending: true,
    declarations: [{ mediaId: f.media.id, intent: "no_longer_request" }],
  });
  const app = new Hono<{
    Variables: { actor: MediaActor; requestId: string };
  }>();
  app.onError((error, c) =>
    c.json(
      { error: error.message },
      error instanceof MediaError ? error.status : 500,
    ),
  );
  // This harness supplies a fixed authenticated member; the production app's
  // authentication/CSRF middleware is independently exercised in app.test.ts.
  app.use("*", async (c, next) => {
    c.set("actor", f.member);
    c.set("requestId", "fixture");
    await next();
  });
  registerRecoveryRoutes(app, f.service);
  const detail = await app.request(`/api/v1/recovery/reviews/${review.id}`);
  expect(detail.status).toBe(200);
  const text = await detail.text();
  expect(text).toContain(f.media.title);
  expect(text).not.toContain(f.owner.id);
  expect(text).not.toContain(f.asset.checksum);
  expect(text).toContain('"responseHash":null');
  expect(text).toContain('"requests":[]');
  expect(text).toContain('"responses":[]');
  const proxy = await app.request(
    `/api/v1/recovery/reviews/${review.id}/responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        userId: f.owner.id,
        scopeHash: review.scopeHash,
        acknowledgePending: true,
        declarations: [{ mediaId: f.media.id, intent: "request" }],
      }),
    },
  );
  expect(proxy.status).toBe(400);
  await f.db.plexIdentityMapping.update({
    where: { userId: f.member.id },
    data: {
      permittedSectionIds: ["2"],
      permittedMediaKinds: ["series"],
      version: { increment: 1 },
    },
  });
  const forbidden = await app.request(`/api/v1/recovery/reviews/${review.id}`);
  expect(forbidden.status).toBe(403);
  const list = await app.request("/api/v1/recovery");
  expect(list.status).toBe(200);
  expect(await list.text()).not.toContain(f.media.title);
});
