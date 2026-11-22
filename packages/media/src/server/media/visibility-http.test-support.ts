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
    expect(body).not.toMatch(/PRIVATE|SECRET|providerReceipt|infoHash/u);
    const joined = MediaDetailSchema.parse(JSON.parse(body));
    // The household sees who follows a title, by name and nothing else: the
    // member's name is a follower, and none of their identifiers or their
    // request is in the response. Their name is no longer a request's `user`.
    expect(joined.followers).toEqual([
      { displayName: f.owner.displayName, me: true },
      { displayName: f.member.displayName, me: false },
    ]);
    expect(joined.requests.map((row) => row.user.displayName)).toEqual([
      f.owner.displayName,
    ]);
    expect(body).not.toContain(f.member.id);
    expect(body).not.toContain(f.request.id);
    expect(joined.visibility.torrents[0]?.diagnostics).toBeNull();
    expect(detail.visibility.attempts.map((row) => row.id)).toEqual([
      f.attempt.id,
    ]);
    expect(joined.visibility.attempts).toEqual([]);
    expect(body).not.toContain(f.attempt.id);
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
