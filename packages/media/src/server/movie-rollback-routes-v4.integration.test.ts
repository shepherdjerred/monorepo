import { expect, test } from "vitest";
import { createMovieRollbackHttpFixture } from "#testing/movie-workflow/rollback/rollback-http-fixture.ts";
import { movieRollbackVideos } from "#testing/movie-workflow/rollback/rollback-fixture.ts";
import { publicMovieHttpJson } from "#testing/movie-workflow/public-http-fixture.ts";
import { MovieRollbackViewV1Schema } from "#shared/movie-editions/rollback/view.ts";
import {
  RequestMovieRollbackV1Schema,
  RequestMovieRollbackResultV1Schema,
} from "#shared/movie-editions/rollback/manual-command.ts";

test("actual owner HTTP rollback discovery and command preserve the exact served pair and original window", async () => {
  const f = await createMovieRollbackHttpFixture(
    "extended_cut",
    await movieRollbackVideos(),
  );
  try {
    const path = `/api/v4/media/${f.scope.mediaId}/movie-editions/${f.scope.edition}/rollback`;
    expect(await responseStatus(fetch(`${f.http.origin}${path}`))).toBe(401);
    expect(await responseStatus(f.memberBrowser.request(path))).toBe(403);
    const review = MovieRollbackViewV1Schema.parse(
      await publicMovieHttpJson(await f.ownerBrowser.request(path)),
    );
    expect(review.state).toBe("request");
    if (review.state !== "request")
      throw new Error("Actual served B must expose its retained A review");
    expect(review.scope).toEqual(f.scope);
    expect(review.predecessor?.id).toBe(f.asset.id);
    expect(review.successor?.id).toBe(f.plan.entries[0].assetId);
    expect(review.originalDeadline).toBe(
      review.command.expected.cleanup.expiresAt,
    );
    const body = RequestMovieRollbackV1Schema.parse({
      ...review.command,
      reason: "Restore the exact reviewed previous extended-cut video",
      confirmRestorePredecessor: true,
      confirmRetainRejectedSuccessor: true,
    });
    const state = await f.state();
    const immutable = await f.immutable();
    expect(
      await responseStatus(
        f.memberBrowser.request(path, { key: crypto.randomUUID(), body }),
      ),
    ).toBe(403);
    const wrongPath = `/api/v4/media/${f.scope.mediaId}/movie-editions/directors_cut/rollback`;
    expect(
      await responseStatus(
        f.ownerBrowser.request(wrongPath, {
          key: crypto.randomUUID(),
          body,
        }),
      ),
    ).toBe(409);
    expect(
      await responseStatus(
        f.ownerBrowser.request(path, {
          key: crypto.randomUUID(),
          body: {
            ...body,
            expected: {
              ...body.expected,
              targetVersion: body.expected.targetVersion + 1,
            },
          },
        }),
      ),
    ).toBe(409);
    expect(
      await f.db.operation.count({
        where: { kind: "rollback_movie_edition_v1" },
      }),
    ).toBe(0);
    const key = crypto.randomUUID();
    const accepted = RequestMovieRollbackResultV1Schema.parse(
      await publicMovieHttpJson(
        await f.ownerBrowser.request(path, { key, body }),
        202,
      ),
    );
    expect(
      RequestMovieRollbackResultV1Schema.parse(
        await publicMovieHttpJson(
          await f.ownerBrowser.request(path, { key, body }),
          202,
        ),
      ),
    ).toEqual(accepted);
    expect(accepted).toMatchObject({
      scope: f.scope,
      sourceAttemptId: f.input.attemptId,
      expiresAt: review.originalDeadline,
    });
    expect(
      await f.db.operation.count({
        where: { kind: "rollback_movie_edition_v1" },
      }),
    ).toBe(1);
    const pending = MovieRollbackViewV1Schema.parse(
      await publicMovieHttpJson(await f.ownerBrowser.request(path)),
    );
    expect(pending).toMatchObject({
      state: "in_progress",
      reason: "workflow_state_unknown",
      command: null,
    });
    expect(
      f.starts.filter(
        (start) => start.workflowType === "rollbackMovieEditionV1Workflow",
      ),
    ).toMatchObject([
      {
        workflowId: `media-operation-${accepted.operationId}`,
        input: {
          operationId: accepted.operationId,
          scope: f.scope,
          sourceAttemptId: f.input.attemptId,
        },
      },
    ]);
    expect(await f.state()).toEqual(state);
    expect(await f.immutable()).toEqual(immutable);
    expect(f.http.errors).toEqual([]);
  } finally {
    await f.close();
  }
}, 60_000);

async function responseStatus(promise: Promise<Response>) {
  const response = await promise;
  return response.status;
}
