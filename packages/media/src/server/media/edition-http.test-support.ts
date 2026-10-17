import { expect } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { commandFixture } from "#infrastructure/editions/command-test-support.ts";
import {
  DefaultCommandV2Schema,
  DefaultCommandResultV2Schema,
} from "#shared/editions/commands.ts";
import { DefaultTargetViewSchema } from "#shared/editions/target-view.ts";
import { createMediaApp, type MediaAppDependencies } from "#server/app.ts";

export async function verifyDefaultCommandsHttp(
  dependencies: MediaAppDependencies,
  headers: Record<string, string>,
) {
  const cluster = await startMediaTestPostgres();
  try {
    const db = cluster.database;
    const f = await commandFixture(db);
    dependencies.media = f.service;
    dependencies.auth.authenticate = () =>
      Promise.resolve({
        actor: f.actor,
        csrfHash: "csrf-hash",
      });
    const app = createMediaApp(dependencies);
    const base = `/api/v2/media/${f.media.id}`;
    const read = await app.request(`${base}/targets/default`, { headers });
    expect(read.status).toBe(200);
    const context = DefaultTargetViewSchema.parse(await read.json());
    expect(context).toMatchObject({
      access: "detail",
      expected: { mediaVersion: 0, targetVersion: null },
      target: null,
    });
    expect(await db.mediaIntent.count({ where: { mediaId: f.media.id } })).toBe(
      0,
    );
    const input = DefaultCommandV2Schema.parse({
      schemaVersion: 2,
      scope: context.scope,
      expected: context.expected,
      command: { action: "request" },
    });
    for (const badHeaders of [
      { ...headers, Origin: "https://attacker.example" },
      { ...headers, "X-CSRF-Token": "wrong" },
    ]) {
      const response = await app.request(`${base}/commands`, {
        method: "POST",
        headers: badHeaders,
        body: JSON.stringify(input),
      });
      expect(response.status).toBe(403);
    }
    for (const malformed of [
      { ...input, scope: { ...input.scope, edition: "named" } },
      { ...input, command: { ...input.command, mediaId: f.media.id } },
      { ...input, actorId: f.actor.id },
    ]) {
      const response = await app.request(`${base}/commands`, {
        method: "POST",
        headers,
        body: JSON.stringify(malformed),
      });
      expect(response.status).toBe(400);
    }
    const mismatch = await app.request(
      `/api/v2/media/${crypto.randomUUID()}/commands`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      },
    );
    expect(mismatch.status).toBe(422);
    expect(await db.operation.count({ where: { targetId: f.media.id } })).toBe(
      0,
    );
    const created = await app.request(`${base}/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(created.status).toBe(200);
    const result = DefaultCommandResultV2Schema.parse(await created.json());
    expect(result.appliedVersions).toEqual({
      mediaVersion: 1,
      targetVersion: 0,
    });
    const stale = await app.request(`${base}/commands`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(input),
    });
    expect(stale.status).toBe(409);
    await db.plexIdentityMapping.update({
      where: { userId: f.actor.id },
      data: { permittedSectionIds: [] },
    });
    const hidden = await app.request(`/api/v1/media/${f.media.id}`, {
      headers,
    });
    expect(hidden.status).toBe(403);
    const protectedRead = await app.request(`${base}/targets/default`, {
      headers,
    });
    expect(protectedRead.status).toBe(200);
    const minimal = DefaultTargetViewSchema.parse(await protectedRead.json());
    expect(minimal.access).toBe("protection_only");
    expect(JSON.stringify(minimal)).not.toContain(f.media.title);
    expect(minimal.allowedProtectiveActions).toEqual([
      "keep",
      "cancel_request",
    ]);
    const requestList = await app.request("/api/v1/requests", { headers });
    expect(requestList.status).toBe(200);
    dependencies.requestsEnabled = () => Promise.resolve(false);
    const kept = await app.request(`${base}/commands`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        ...input,
        expected: minimal.expected,
        command: { action: "keep" },
      }),
    });
    expect(kept.status).toBe(200);
    const versions = DefaultCommandResultV2Schema.parse(
      await kept.json(),
    ).appliedVersions;
    const cancelled = await app.request(`${base}/commands`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        ...input,
        expected: versions,
        command: {
          action: "cancel_request",
          requestId: result.result.requestId,
          requestVersion: 0,
        },
      }),
    });
    expect(cancelled.status).toBe(200);
    expect(
      await db.mediaRequest.findUniqueOrThrow({
        where: {
          userId_mediaId_edition: { userId: f.actor.id, ...context.scope },
        },
      }),
    ).toMatchObject({ active: false, excluded: true });
    expect(dependencies.onError).not.toHaveBeenCalled();
  } finally {
    await cluster.close();
  }
}
