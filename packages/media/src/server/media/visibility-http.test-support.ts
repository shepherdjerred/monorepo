import { expect } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { visibilityFixture } from "#infrastructure/visibility/test-fixture.ts";
import { createMediaApp, type MediaAppDependencies } from "#server/app.ts";
import { MediaDetailSchema } from "#shared/api.ts";

export async function verifyVisibilityHttp(
  dependencies: MediaAppDependencies,
  headers: Record<string, string>,
) {
  const cluster = await startMediaTestPostgres();
  try {
    const f = await visibilityFixture(cluster.database);
    await f.publish();
    const before = {
      outbox: await f.db.outboxCommand.findMany({ orderBy: { id: "asc" } }),
      operations: await f.db.operation.findMany({ orderBy: { id: "asc" } }),
    };
    dependencies.media = f.app;
    dependencies.auth.authenticate = () =>
      Promise.resolve({ actor: f.owner, csrfHash: "csrf-hash" });
    const app = createMediaApp(dependencies);
    const url = `/api/v1/media/${f.media.id}`;
    const owner = await app.request(url, { headers });
    expect(owner.status).toBe(200);
    const detail = MediaDetailSchema.parse(await owner.json());
    expect(detail.visibility.torrents[0]?.diagnostics?.policy).toEqual({
      kind: "public",
    });
    await f.db.mediaRequest.create({
      data: { userId: f.owner.id, mediaId: f.media.id },
    });
    await f.db.mediaUser.update({
      where: { id: f.owner.id },
      data: { role: "member" },
    });
    const demoted = await app.request(url, { headers });
    expect(demoted.status).toBe(200);
    const body = await demoted.text();
    expect(body).not.toMatch(
      /PRIVATE|SECRET|"displayName":"Member"|providerReceipt|infoHash/u,
    );
    const joined = MediaDetailSchema.parse(JSON.parse(body));
    expect(joined.visibility.torrents[0]?.diagnostics).toBeNull();
    expect(joined.visibility.attempts.map((row) => row.id)).toEqual([
      f.attempt.id,
    ]);
    expect(joined.visibility.torrents.map((row) => row.id)).toEqual([
      f.torrent.id,
    ]);
    expect(joined.requests.map((row) => row.userId)).toEqual([f.owner.id]);
    await f.db.plexIdentityMapping.update({
      where: { userId: f.owner.id },
      data: { permittedSectionIds: ["9"] },
    });
    const denied = await app.request(url, { headers });
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain(f.media.title);
    expect({
      outbox: await f.db.outboxCommand.findMany({ orderBy: { id: "asc" } }),
      operations: await f.db.operation.findMany({ orderBy: { id: "asc" } }),
    }).toEqual(before);
  } finally {
    await cluster.close();
  }
}
