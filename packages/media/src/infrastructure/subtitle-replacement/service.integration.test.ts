import { expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { Hono } from "hono";
import {
  targetHarness,
  subtitleTransport,
} from "#automation/subtitles/target-fixture.ts";
import { createSubtitleActivities } from "#automation/subtitles.ts";
import { fromOpenSubtitles } from "#automation/subtitle-sources.ts";
import { PrismaSubtitleReplacements } from "./service.ts";
import { registerSubtitleReplacementRoutes } from "#server/subtitle-replacement-routes.ts";
import { MediaError } from "#application/errors.ts";
import { createOutboxActivities } from "#automation/store.ts";
import type { MediaActor } from "#application/auth.ts";

const harness = targetHarness();
async function fixture() {
  const f = await harness.setup();
  const actor = await f.db.mediaUser.update({
    where: { id: f.user.id },
    data: { role: "owner" },
  });
  await f.queue();
  const inputs = await f.inputs();
  const input = inputs.find((item) => !item.forced);
  if (input === undefined) throw new Error("Missing regular subtitle target");
  const provider = subtitleTransport();
  const found = await createSubtitleActivities(f.network, {
    opensubtitles: (context, search) =>
      fromOpenSubtitles(context, search, provider.transport),
  }).findMediaSubtitles(input);
  const candidate = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: found.subtitleId ?? "missing" },
  });
  const oldBytes = "1\n00:00:01,000 --> 00:00:02,000\nOld uncertain subtitle\n";
  const destination =
    f.asset.path.slice(0, -path.extname(f.asset.path).length) + ".en.srt";
  await writeFile(destination, oldBytes);
  const old = await f.db.subtitleAsset.create({
    data: {
      assetId: f.asset.id,
      language: "en",
      providerId: "migration",
      state: "installed",
      storageKind: "sidecar",
      qualityStatus: "unverified",
      ownershipEpoch: 0,
      videoVersion: f.asset.version,
      videoChecksum: f.asset.checksum,
      checksum: createHash("sha256").update(oldBytes).digest("hex"),
      path: destination,
      forced: false,
      hearingImpaired: false,
      provenance: { fixture: true },
      matchingEvidence: {},
    },
  });
  const describe = vi.fn(async () => ({
    runId: crypto.randomUUID(),
    status: "COMPLETED" as const,
  }));
  const service = new PrismaSubtitleReplacements(f.db, describe);
  const prepare = {
    oldSubtitleId: old.id,
    candidateSubtitleId: candidate.id,
    expectedOldVersion: old.version,
    expectedCandidateVersion: candidate.version,
  };
  return { ...f, actor, old, candidate, service, describe, prepare };
}

test("concurrent idempotent preparation has one reservation and one transactional outbox command", async () => {
  const f = await fixture();
  const key = crypto.randomUUID();
  const results = await Promise.all([
    f.service.prepare(f.actor, key, f.prepare),
    f.service.prepare(f.actor, key, f.prepare),
  ]);
  expect(results[0]).toEqual(results[1]);
  const rows = await f.db.subtitleReplacement.findMany({
    where: { assetId: f.asset.id },
  });
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (row === undefined) throw new Error("Missing prepared replacement");
  expect(rows[0]).toMatchObject({
    state: "preparing",
    reservationActive: true,
  });
  expect(
    await f.db.operation.count({
      where: { targetId: row.id, kind: "prepare_subtitle_replacement" },
    }),
  ).toBe(1);
  await expect(
    f.service.prepare(f.actor, crypto.randomUUID(), f.prepare),
  ).rejects.toMatchObject({ reason: "subtitle_replacement_unsettled" });
  const started = vi.fn(() => Promise.resolve());
  await createOutboxActivities(f.db, started).dispatchMediaOutbox();
  expect(started).toHaveBeenCalledWith(
    expect.objectContaining({
      workflowType: "prepareSubtitleReplacementWorkflow",
      input: expect.objectContaining({ replacementId: rows[0]?.id }),
    }),
  );
  expect(
    await f.db.libraryAsset.findUnique({ where: { id: f.asset.id } }),
  ).toMatchObject({ version: f.asset.version });
});

test.each(["restricted", "demoted"] as const)(
  "current %s owner cannot prepare with a stale actor object",
  async (kind) => {
    const f = await fixture();
    await f.db.mediaUser.update({
      where: { id: f.actor.id },
      data: kind === "restricted" ? { restricted: true } : { role: "member" },
    });
    await expect(
      f.service.prepare(f.actor, crypto.randomUUID(), f.prepare),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await f.db.subtitleReplacement.count({ where: { assetId: f.asset.id } }),
    ).toBe(0);
  },
);

test("review and reservation authority are immutable, and live executor blocks reconciliation", async () => {
  const f = await fixture();
  const result = await f.service.prepare(
    f.actor,
    crypto.randomUUID(),
    f.prepare,
  );
  const id = result.subtitleReplacementId ?? "missing";
  await expect(
    f.db.subtitleReplacement.update({
      where: { id },
      data: { recoveryEpoch: 1 },
    }),
  ).rejects.toThrow();
  const running = new PrismaSubtitleReplacements(f.db, async () => ({
    status: "RUNNING",
    runId: "running",
  }));
  await expect(
    running.reconcile(f.actor, crypto.randomUUID(), id, { expectedVersion: 0 }),
  ).rejects.toMatchObject({ code: "subtitle_replacement_executor_active" });
  expect(
    await f.db.subtitleReplacement.findUnique({ where: { id } }),
  ).toMatchObject({ state: "preparing", version: 0, reservationActive: true });
  const key = crypto.randomUUID();
  const recovered = await f.service.reconcile(f.actor, key, id, {
    expectedVersion: 0,
  });
  expect(recovered.status).toBe("queued");
  expect(
    await running.reconcile(f.actor, key, id, { expectedVersion: 0 }),
  ).toEqual(recovered);
  expect(
    await f.db.subtitleReplacement.findUnique({ where: { id } }),
  ).toMatchObject({ state: "reconciling", reservationActive: true });
});

test("HTTP review is current-owner only and omits filesystem evidence and content", async () => {
  const f = await fixture();
  const result = await f.service.prepare(
    f.actor,
    crypto.randomUUID(),
    f.prepare,
  );
  let actor: MediaActor = f.actor;
  const app = new Hono<{
    Variables: { actor: MediaActor; requestId: string };
  }>();
  app.onError((error, c) =>
    c.json(
      { error: error instanceof MediaError ? error.code : "unexpected" },
      error instanceof MediaError ? error.status : 500,
    ),
  );
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    c.set("requestId", "test");
    await next();
  });
  registerSubtitleReplacementRoutes(app, f.service);
  const url = `/api/v1/admin/subtitle-replacements/${result.subtitleReplacementId ?? "missing"}`;
  const response = await app.request(url);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).toContain('"oldQuality":"unverified"');
  expect(text).not.toContain(f.asset.path);
  expect(text).not.toContain("matchingEvidence");
  expect(text).not.toContain("Old uncertain subtitle");
  actor = { ...f.actor, role: "member" };
  const memberResponse = await app.request(url);
  expect(memberResponse.status).toBe(403);
  actor = f.actor;
  await f.db.mediaUser.update({
    where: { id: actor.id },
    data: { restricted: true },
  });
  const restrictedResponse = await app.request(url);
  expect(restrictedResponse.status).toBe(403);
});
