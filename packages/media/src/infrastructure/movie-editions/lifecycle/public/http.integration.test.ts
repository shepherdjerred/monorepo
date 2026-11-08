import { expect, test } from "vitest";
import {
  createPublicMovieHttpFixture,
  publicMovieHttpJson as read,
} from "#testing/movie-workflow/public-http-fixture.ts";
import {
  ActivateMovieEditionChoiceV4Schema,
  ActivateMovieEditionChoiceResultV4Schema,
  MovieEditionContextV4Schema,
  MovieEditionRequestListV4Schema,
  MovieTargetContextV4Schema,
} from "#shared/movie-editions/lifecycle/public-v4.ts";
import {
  CancelMovieRequestV4Schema,
  CancelMovieRequestResultV4Schema,
} from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import { MovieRequestResultV3Schema } from "#shared/movie-editions/commands.ts";

test("real authenticated v4 routes activate and cancel the exact saved choice while retaining its v3 ACK", async () => {
  const f = await createPublicMovieHttpFixture();
  try {
    const base = `/api/v4/media/${f.mediaId}`;
    const anonymous = await fetch(
      `${f.http.origin}${base}/movie-edition-context`,
    );
    expect(anonymous.status).toBe(401);
    const context = MovieEditionContextV4Schema.parse(
      await read(await f.browser.request(`${base}/movie-edition-context`)),
    );
    const option = context.options.find(
      (row) => row.edition === "directors_cut",
    );
    const scope = {
      rootMediaId: f.mediaId,
      mediaId: f.mediaId,
      edition: "directors_cut",
    };
    expect(option).toMatchObject({
      activationRequired: true,
      request: { choiceId: f.chosen.choiceId },
    });
    const input = ActivateMovieEditionChoiceV4Schema.parse({
      schemaVersion: 4,
      scope,
      subjectUserId: f.owner.id,
      requestId: f.chosen.requestId,
      choiceId: f.chosen.choiceId,
      expected: {
        mediaVersion: context.mediaVersion,
        targetVersion: option?.targetVersion,
        requestVersion: option?.request?.version,
        choiceRevision: option?.request?.choiceRevision,
      },
    });
    const path = `${base}/movie-requests/${input.requestId}/activate-choice`;
    const anonymousWrite = await fetch(`${f.http.origin}${path}`, {
      method: "POST",
      headers: { Origin: f.http.origin, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(anonymousWrite.status).toBe(401);
    const wrongScope = await f.browser.request(
      `/api/v4/media/${crypto.randomUUID()}/movie-requests/${input.requestId}/activate-choice`,
      { key: crypto.randomUUID(), body: input },
    );
    expect(wrongScope.status).toBe(409);
    const key = crypto.randomUUID();
    const activated = ActivateMovieEditionChoiceResultV4Schema.parse(
      await read(await f.browser.request(path, { key, body: input })),
    );
    expect(activated).toMatchObject({
      state: "queued",
      choiceId: f.chosen.choiceId,
      edition: "directors_cut",
    });
    expect(
      await read(await f.browser.request(path, { key, body: input })),
    ).toEqual(activated);
    expect(
      await f.db.movieEditionChoice.findUniqueOrThrow({
        where: { id: f.chosen.choiceId },
      }),
    ).toEqual(f.originalChoice);
    const page = MovieEditionRequestListV4Schema.parse(
      await read(await f.browser.request("/api/v4/movie-requests")),
    );
    expect(
      page.items.find((row) => row.requestId === input.requestId),
    ).toMatchObject({ activationRequired: false });
    const target = MovieTargetContextV4Schema.parse(
      await read(
        await f.browser.request(`${base}/movie-editions/directors_cut`),
      ),
    );
    expect(target.scope).toEqual(scope);
    const request = await f.db.mediaRequest.findUniqueOrThrow({
      where: { id: input.requestId },
    });
    const cancellation = CancelMovieRequestV4Schema.parse({
      schemaVersion: 4,
      scope,
      subjectUserId: f.owner.id,
      requestId: request.id,
      action: "cancel_request",
      expected: {
        targetVersion: target.expected.targetVersion,
        requestVersion: request.version,
        choiceRevision: request.movieEditionChoiceRevision,
      },
    });
    const cancelled = CancelMovieRequestResultV4Schema.parse(
      await read(
        await f.browser.request(`${base}/movie-requests/${request.id}/cancel`, {
          key: crypto.randomUUID(),
          body: cancellation,
        }),
      ),
    );
    expect(cancelled.state).toBe("cancelled");
    const old = MovieRequestResultV3Schema.parse(
      await read(
        await f.browser.request(`/api/v3/media/${f.mediaId}/movie-requests`, {
          key: f.originalKey,
          body: f.originalInput,
        }),
      ),
    );
    expect(old).toEqual(f.chosen);
  } finally {
    await f.close();
  }
}, 60_000);
