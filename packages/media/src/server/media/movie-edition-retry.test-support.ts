import { expect, vi } from "vitest";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { commandFixture } from "#infrastructure/editions/command-test-support.ts";
import {
  MovieEditionContextV3Schema,
  MovieEditionRequestListV3Schema,
} from "#shared/movie-editions/view.ts";
import { MovieRequestResultV3Schema } from "#shared/movie-editions/commands.ts";
import { ApiError } from "#client/api.ts";
import { movieRequest } from "#client/movie-editions/api.ts";
import {
  movieProtectionAttempt,
  movieProtectionMutationOptions,
  movieProtectionSubmission,
  protectionRetryLabel,
  unresolvedMovieProtection,
} from "#client/movie-editions/protection.ts";
import { createMediaApp, type MediaAppDependencies } from "#server/app.ts";

async function retryFixture(
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
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    });
    vi.stubGlobal("document", { cookie: "media-csrf=csrf-token" });
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const observer = new MutationObserver(
      client,
      movieProtectionMutationOptions(),
    );
    const unsubscribe = observer.subscribe((result) => {
      if (result.variables !== undefined)
        expect(result.variables.actorId).toBe(f.actor.id);
    });
    const calls: {
      path: string;
      body: BodyInit | null | undefined;
      key: string | null;
      status: number;
    }[] = [];
    async function dispatch(path: string, init: RequestInit) {
      const mergedHeaders = new Headers(headers);
      new Headers(init.headers).forEach((value, key) => {
        mergedHeaders.set(key, value);
      });
      const response = await app.request(path, {
        ...init,
        headers: mergedHeaders,
      });
      calls.push({
        path,
        body: init.body,
        key: new Headers(init.headers).get("Idempotency-Key"),
        status: response.status,
      });
      return response;
    }
    async function choose() {
      const contextResponse = await app.request(
        `/api/v3/media/${f.media.id}/movie-edition-context`,
        { headers },
      );
      expect(contextResponse.status).toBe(200);
      const context = MovieEditionContextV3Schema.parse(
        await contextResponse.json(),
      );
      const input = movieRequest(context, "directors_cut", "en");
      const response = await app.request(
        `/api/v3/media/${f.media.id}/movie-requests`,
        {
          method: "POST",
          headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(input),
        },
      );
      expect(response.status).toBe(200);
      return MovieRequestResultV3Schema.parse(await response.json());
    }
    async function row() {
      const response = await app.request("/api/v3/movie-requests", { headers });
      expect(response.status).toBe(200);
      const current = MovieEditionRequestListV3Schema.parse(
        await response.json(),
      ).items.find((item) => item.scope.mediaId === f.media.id);
      if (current === undefined)
        throw new Error("Actual request missing from polled list");
      return current;
    }
    return {
      db,
      f,
      observer,
      calls,
      dispatch,
      choose,
      row,
      async close() {
        unsubscribe();
        client.clear();
        vi.unstubAllGlobals();
        await cluster.close();
      },
    };
  } catch (error) {
    vi.unstubAllGlobals();
    await cluster.close();
    throw error;
  }
}

export async function verifyMovieProtectionLostAck(
  dependencies: MediaAppDependencies,
  headers: Record<string, string>,
  action: "cancel_request" | "revoke_choice",
) {
  const f = await retryFixture(dependencies, headers);
  try {
    const chosen = await f.choose();
    const originalRow = await f.row();
    const original = movieProtectionSubmission({
      actorId: f.f.actor.id,
      subjectUserId: f.f.actor.id,
      request: originalRow,
      action,
    });
    let loseResponse = true;
    vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
      const response = await f.dispatch(path, init);
      expect(response.status).toBe(200);
      if (loseResponse) {
        loseResponse = false;
        if (action === "cancel_request")
          throw new TypeError("Response lost after actual commit");
        return Response.json(
          {
            error: {
              code: "gateway_unknown",
              message: "Response lost after actual commit",
            },
          },
          { status: 503 },
        );
      }
      return response;
    });
    await expect(f.observer.mutate(original)).rejects.toThrow(
      "Response lost after actual commit",
    );
    expect(
      await f.db.mediaRequest.findUniqueOrThrow({
        where: { id: chosen.requestId },
      }),
    ).toMatchObject({
      active: action !== "cancel_request",
      movieEditionChoiceId: null,
    });
    const renewed = await f.choose();
    expect(renewed.requestId).toBe(chosen.requestId);
    expect(renewed.choiceId).not.toBe(chosen.choiceId);
    const latest = await f.row();
    expect(latest.choiceRevision).toBeGreaterThan(originalRow.choiceRevision);
    const laterRow = await f.db.mediaRequest.findUniqueOrThrow({
      where: { id: renewed.requestId },
    });
    const targetKey = {
      mediaId: latest.scope.mediaId,
      edition: latest.scope.edition,
    };
    const laterTarget = await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: targetKey },
    });
    const proposedCancel = movieProtectionSubmission({
      actorId: f.f.actor.id,
      subjectUserId: f.f.actor.id,
      request: latest,
      action: "cancel_request",
    });
    const unknown = unresolvedMovieProtection(f.observer.getCurrentResult());
    expect(unknown).toEqual(original);
    expect(protectionRetryLabel(original)).toBe(
      action === "cancel_request"
        ? "Retry original cancellation"
        : "Retry original revocation",
    );
    const retry = movieProtectionAttempt(
      f.observer.getCurrentResult(),
      proposedCancel,
    );
    expect(retry).toBe(original);
    const result = await f.observer.mutate(retry);
    expect(result.state).toBe(
      action === "cancel_request" ? "cancelled" : "pending_choice",
    );
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]).toEqual(f.calls[0]);
    expect(f.calls[0]?.body).toBe(JSON.stringify(original.body));
    expect(f.calls[0]?.key).toBeTruthy();
    expect(
      await f.db.mediaRequest.findUniqueOrThrow({
        where: { id: renewed.requestId },
      }),
    ).toEqual(laterRow);
    expect(
      await f.db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: targetKey },
      }),
    ).toEqual(laterTarget);
    expect(laterRow).toMatchObject({
      active: true,
      movieEditionChoiceId: renewed.choiceId,
    });
    expect(unresolvedMovieProtection(f.observer.getCurrentResult())).toBeNull();
    expect(dependencies.onError).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
}

export async function verifyMovieProtectionConflictReview(
  dependencies: MediaAppDependencies,
  headers: Record<string, string>,
) {
  const f = await retryFixture(dependencies, headers);
  try {
    await f.choose();
    const originalRow = await f.row();
    const original = movieProtectionSubmission({
      actorId: f.f.actor.id,
      subjectUserId: f.f.actor.id,
      request: originalRow,
      action: "cancel_request",
    });
    const renewed = await f.choose();
    vi.stubGlobal("fetch", f.dispatch);
    await expect(f.observer.mutate(original)).rejects.toMatchObject({
      status: 409,
    });
    const latest = await f.row();
    const proposed = movieProtectionSubmission({
      actorId: f.f.actor.id,
      subjectUserId: f.f.actor.id,
      request: latest,
      action: "cancel_request",
    });
    expect(() =>
      movieProtectionAttempt(f.observer.getCurrentResult(), proposed),
    ).toThrow(ApiError);
    expect(f.calls).toHaveLength(1);
    expect(
      await f.db.mediaRequest.findUniqueOrThrow({
        where: { id: renewed.requestId },
      }),
    ).toMatchObject({ active: true, movieEditionChoiceId: renewed.choiceId });
    // The UI's explicit Review action refreshes first, then resets the conflict.
    f.observer.reset();
    const reviewed = movieProtectionAttempt(
      f.observer.getCurrentResult(),
      proposed,
    );
    expect(reviewed.body.expected).toEqual(proposed.body.expected);
    const result = await f.observer.mutate(reviewed);
    expect(result.state).toBe("cancelled");
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]?.key).not.toBe(f.calls[1]?.key);
    expect(f.calls[0]?.body).not.toBe(f.calls[1]?.body);
    expect(
      await f.db.mediaRequest.findUniqueOrThrow({
        where: { id: renewed.requestId },
      }),
    ).toMatchObject({ active: false, movieEditionChoiceId: null });
    expect(dependencies.onError).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
}
