import { expect } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { commandFixture } from "#infrastructure/editions/command-test-support.ts";
import {
  MovieEditionContextV3Schema,
  MovieEditionRequestListV3Schema,
} from "#shared/movie-editions/view.ts";
import {
  MovieRequestResultV3Schema,
  CancelMovieRequestResultV3Schema,
  RevokeMovieEditionChoiceResultV3Schema,
} from "#shared/movie-editions/commands.ts";
import { createMediaApp, type MediaAppDependencies } from "#server/app.ts";

export async function verifyMovieEditionHttp(
  dependencies: MediaAppDependencies,
  headers: Record<string, string>,
) {
  const cluster = await startMediaTestPostgres();
  const db = cluster.database;
  try {
    const f = await commandFixture(db);
    dependencies.media = f.service;
    dependencies.auth.authenticate = () =>
      Promise.resolve({ actor: f.actor, csrfHash: "csrf-hash" });
    const app = createMediaApp(dependencies);
    const base = `/api/v3/media/${f.media.id}`;
    const before = await movieRows(db, f.media.id);
    const read = await app.request(`${base}/movie-edition-context`, {
      headers,
    });
    expect(read.status).toBe(200);
    const context = MovieEditionContextV3Schema.parse(await read.json());
    const second = await app.request(`${base}/movie-edition-context`, {
      headers,
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(context);
    expect(await movieRows(db, f.media.id)).toEqual(before);
    const selected = context.options.find(
      (option) => option.edition === "theatrical_cut",
    );
    if (selected === undefined) throw new Error("Theatrical option absent");
    const input = {
      schemaVersion: 3,
      mediaId: f.media.id,
      subjectUserId: f.actor.id,
      expected: {
        mediaVersion: context.mediaVersion,
        targetVersion: selected.targetVersion,
        definition: selected.storedDefinition,
        request: null,
      },
      selection: {
        edition: selected.edition,
        definitionVersion: selected.definitionVersion,
        definitionDigest: selected.definitionDigest,
        registryVersion: context.registryVersion,
      },
      options: { subtitleLanguages: ["en"] },
    };
    const badScope = await app.request(
      `/api/v3/media/${crypto.randomUUID()}/movie-requests`,
      { method: "POST", headers, body: JSON.stringify(input) },
    );
    expect(badScope.status).toBe(409);
    const missing = await app.request(`${base}/movie-requests`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...input, selection: undefined }),
    });
    expect(missing.status).toBe(400);
    expect(await movieRows(db, f.media.id)).toEqual(before);
    const created = await app.request(`${base}/movie-requests`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(created.status).toBe(200);
    const result = MovieRequestResultV3Schema.parse(await created.json());
    expect(result).toMatchObject({
      edition: "theatrical_cut",
      state: "pending",
      reason: "edition_acquisition_not_ready",
      operationId: null,
    });
    const list = await app.request("/api/v3/movie-requests", { headers });
    expect(list.status).toBe(200);
    const row = MovieEditionRequestListV3Schema.parse(
      await list.json(),
    ).items.find((item) => item.requestId === result.requestId);
    if (row === undefined)
      throw new Error("Actual named request absent from own list");
    expect(row).toMatchObject({
      canCancel: true,
      fulfillment: { status: "pending_edition" },
    });
    const cancel = {
      schemaVersion: 3,
      subjectUserId: f.actor.id,
      scope: row.scope,
      requestId: row.requestId,
      expected: {
        targetVersion: row.targetVersion,
        requestVersion: row.requestVersion,
        choiceRevision: row.choiceRevision,
      },
      action: "cancel_request",
    };
    const cancelHeaders = {
      ...headers,
      "Idempotency-Key": crypto.randomUUID(),
    };
    const cancelled = await app.request(
      `${base}/movie-requests/${row.requestId}/cancel`,
      { method: "POST", headers: cancelHeaders, body: JSON.stringify(cancel) },
    );
    expect(cancelled.status).toBe(200);
    const cancellation = CancelMovieRequestResultV3Schema.parse(
      await cancelled.json(),
    );
    expect(cancellation.state).toBe("cancelled");
    const after = await movieRows(db, f.media.id);
    const replay = await app.request(
      `${base}/movie-requests/${row.requestId}/cancel`,
      { method: "POST", headers: cancelHeaders, body: JSON.stringify(cancel) },
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(cancellation);
    dependencies.requestsEnabled = () => Promise.resolve(false);
    const oldChoice = await app.request(`${base}/movie-requests`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(oldChoice.status).toBe(200);
    expect(await oldChoice.json()).toEqual(result);
    expect(await movieRows(db, f.media.id)).toEqual(after);
    expect(
      await db.mediaRequest.findUniqueOrThrow({
        where: { id: result.requestId },
      }),
    ).toMatchObject({ active: false, movieEditionChoiceId: null });
    expect(await db.acquisitionAttempt.count()).toBe(0);
    expect(await db.torrent.count()).toBe(0);
    expect(dependencies.onError).not.toHaveBeenCalled();
  } finally {
    await cluster.close();
  }
}

async function movieRows(
  db: Awaited<ReturnType<typeof startMediaTestPostgres>>["database"],
  mediaId: string,
) {
  return {
    media: await db.mediaItem.findUniqueOrThrow({ where: { id: mediaId } }),
    definitions: await db.mediaEditionDefinition.findMany({
      where: { rootMediaId: mediaId },
    }),
    targets: await db.mediaIntent.findMany({ where: { mediaId } }),
    requests: await db.mediaRequest.findMany({ where: { mediaId } }),
    choices: await db.movieEditionChoice.findMany({
      where: { rootMediaId: mediaId },
    }),
  };
}

export async function verifyMovieProtectionHttp(
  dependencies: MediaAppDependencies,
  headers: Record<string, string>,
) {
  const cluster = await startMediaTestPostgres();
  try {
    const db = cluster.database;
    const f = await commandFixture(db);
    dependencies.media = f.service;
    dependencies.auth.authenticate = () =>
      Promise.resolve({ actor: f.actor, csrfHash: "csrf-hash" });
    const app = createMediaApp(dependencies);
    const context = await f.service.getMovieEditionContext(
      f.actor,
      f.media.id,
      f.actor.id,
    );
    const selected = context.options.find(
      (option) => option.edition === "directors_cut",
    );
    if (selected === undefined) throw new Error("Director's cut option absent");
    const chosen = await f.service.requestMovieEdition(
      f.actor,
      crypto.randomUUID(),
      {
        schemaVersion: 3,
        mediaId: f.media.id,
        subjectUserId: f.actor.id,
        expected: {
          mediaVersion: context.mediaVersion,
          targetVersion: null,
          definition: null,
          request: null,
        },
        selection: {
          edition: selected.edition,
          definitionVersion: selected.definitionVersion,
          definitionDigest: selected.definitionDigest,
          registryVersion: context.registryVersion,
        },
        options: { subtitleLanguages: [] },
      },
    );
    await db.plexIdentityMapping.update({
      where: { userId: f.actor.id },
      data: { permittedSectionIds: [] },
    });
    dependencies.requestsEnabled = () => Promise.resolve(false);
    const hidden = await app.request(
      `/api/v3/media/${f.media.id}/movie-edition-context`,
      { headers },
    );
    expect(hidden.status).toBe(403);
    const list = await app.request("/api/v3/movie-requests", { headers });
    expect(list.status).toBe(200);
    const result = MovieEditionRequestListV3Schema.parse(await list.json());
    expect(JSON.stringify(result)).not.toContain(f.media.title);
    const row = result.items.find(
      (item) => item.requestId === chosen.requestId,
    );
    if (row === undefined) throw new Error("Protected own request absent");
    expect(row.access).toBe("protection_only");
    const base = `/api/v3/media/${f.media.id}/movie-requests/${row.requestId}`;
    const command = {
      schemaVersion: 3,
      subjectUserId: f.actor.id,
      scope: row.scope,
      requestId: row.requestId,
      expected: {
        targetVersion: row.targetVersion,
        requestVersion: row.requestVersion,
        choiceRevision: row.choiceRevision,
      },
      action: "revoke_choice",
    };
    const revoked = await app.request(`${base}/revoke-choice`, {
      method: "POST",
      headers,
      body: JSON.stringify(command),
    });
    expect(revoked.status).toBe(200);
    const cleared = RevokeMovieEditionChoiceResultV3Schema.parse(
      await revoked.json(),
    );
    expect(
      await db.mediaRequest.findUniqueOrThrow({ where: { id: row.requestId } }),
    ).toMatchObject({ active: true, movieEditionChoiceId: null });
    const cancelInput = {
      ...command,
      action: "cancel_request",
      expected: cleared.applied,
    };
    const before = await movieRows(db, f.media.id);
    const bad = await app.request(`${base}/cancel`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        ...cancelInput,
        scope: { ...row.scope, edition: "default" },
      }),
    });
    expect(bad.status).toBe(409);
    expect(await movieRows(db, f.media.id)).toEqual(before);
    const cancelled = await app.request(`${base}/cancel`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(cancelInput),
    });
    expect(cancelled.status).toBe(200);
    expect(
      CancelMovieRequestResultV3Schema.parse(await cancelled.json()).state,
    ).toBe("cancelled");
    expect(
      await db.movieEditionChoice.count({ where: { rootMediaId: f.media.id } }),
    ).toBe(1);
    expect(await db.acquisitionAttempt.count()).toBe(0);
    expect(dependencies.onError).not.toHaveBeenCalled();
  } finally {
    await cluster.close();
  }
}
