import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { z } from "zod";
import { createMovieReplacementHttpFixture } from "#testing/movie-workflow/subtitles/subtitle-replacement-http-fixture.ts";
import { publicMovieHttpJson } from "#testing/movie-workflow/public-http-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { MovieSubtitleTargetV2Schema } from "#shared/movie-editions/subtitle-target-v2.ts";
import {
  MovieManualReplacementV2Schema,
  MoviePrepareReplacementV2Schema,
  MovieReplacementSnapshotV2Schema,
} from "#shared/movie-editions/subtitle-replacement-v2.ts";
import { SubtitleReplacementDetailSchema } from "#shared/subtitle-replacement.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";

const Input = z.object({
  operationId: z.uuid(),
  replacementId: z.uuid(),
  movieScope: MovieEditionScopeSchema,
});

test("actual named caption context/upload/prepare and generic owner review use production HTTP, real installation parents and native swap", async () => {
  const f = await createMovieReplacementHttpFixture(
    "directors_cut",
    await movieVideoFixture(),
  );
  try {
    const base = `/api/v2/media/${f.scope.mediaId}/movie-editions/${f.scope.edition}`;
    expect(await status(fetch(`${f.http.origin}${base}/subtitle-target`))).toBe(
      401,
    );
    expect(
      await status(f.memberBrowser.request(`${base}/subtitle-target`)),
    ).toBe(403);
    const context = MovieSubtitleTargetV2Schema.parse(
      await publicMovieHttpJson(
        await f.ownerBrowser.request(`${base}/subtitle-target`),
      ),
    );
    expect(context).toMatchObject({
      schemaVersion: 2,
      scope: f.scope,
      assetId: f.old.assetId,
      editionLabel: "Director's cut",
    });
    expect(context.filename).not.toContain("/");
    const selected = context.subtitles.find((row) => row.id === f.old.id);
    if (selected === undefined)
      throw new Error("Actual named context omitted its installed caption");
    expect(selected.state).toBe("installed");
    const baseline = await f.baseline();
    const physical = await f.physical();
    const text = `1\n00:00:00,000 --> 00:00:01,500\n${"Corrected synthetic human caption dialogue. ".repeat(1800)}\n`;
    const body = MovieManualReplacementV2Schema.parse({
      schemaVersion: 2,
      scope: context.scope,
      assetId: context.assetId,
      expectedAssetVersion: context.version,
      expectedChecksum: context.checksum,
      language: "en",
      forced: z.boolean().parse(selected.forced),
      hearingImpaired: z.boolean().parse(selected.hearingImpaired),
      filename: "owner-corrected.srt",
      description:
        "Human captions matched by the owner to this exact named edition",
      contentBase64: Buffer.from(text).toString("base64"),
      declaredEncoding: "utf8",
      confirmedMatchingVideo: true,
      replacementFor: {
        oldSubtitleId: selected.id,
        expectedOldVersion: selected.version,
      },
    });
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(64 * 1024);
    expect(
      await status(
        f.memberBrowser.request(`${base}/subtitle-replacements/candidates`, {
          key: crypto.randomUUID(),
          body,
        }),
      ),
    ).toBe(403);
    const wrong = `/api/v2/media/${f.scope.mediaId}/movie-editions/theatrical_cut`;
    expect(
      await status(
        f.ownerBrowser.request(`${wrong}/subtitle-replacements/candidates`, {
          key: crypto.randomUUID(),
          body,
        }),
      ),
    ).toBe(409);
    expect(
      await f.db.subtitleAsset.count({
        where: { assetId: context.assetId, providerId: "manual" },
      }),
    ).toBe(0);
    const uploadKey = crypto.randomUUID();
    const uploaded = CommandResultSchema.parse(
      await publicMovieHttpJson(
        await f.ownerBrowser.request(
          `${base}/subtitle-replacements/candidates`,
          { key: uploadKey, body },
        ),
      ),
    );
    expect(
      CommandResultSchema.parse(
        await publicMovieHttpJson(
          await f.ownerBrowser.request(
            `${base}/subtitle-replacements/candidates`,
            { key: uploadKey, body },
          ),
        ),
      ),
    ).toEqual(uploaded);
    const candidate = await f.db.subtitleAsset.findUniqueOrThrow({
      where: { id: z.uuid().parse(uploaded.subtitleId) },
    });
    expect(candidate).toMatchObject({
      assetId: context.assetId,
      state: "validated",
      qualityStatus: "accepted",
      matchingEvidence: { schemaVersion: 2, movieScope: f.scope },
    });
    expect(await f.physical()).toEqual(physical);
    expect(await f.baseline()).toEqual(baseline);
    const prepareBody = MoviePrepareReplacementV2Schema.parse({
      schemaVersion: 2,
      scope: f.scope,
      oldSubtitleId: f.old.id,
      candidateSubtitleId: candidate.id,
      expectedOldVersion: selected.version,
      expectedCandidateVersion: candidate.version,
    });
    expect(
      await status(
        f.ownerBrowser.request(`${wrong}/subtitle-replacements`, {
          key: crypto.randomUUID(),
          body: prepareBody,
        }),
      ),
    ).toBe(409);
    expect(
      await status(
        f.memberBrowser.request(`${base}/subtitle-replacements`, {
          key: crypto.randomUUID(),
          body: prepareBody,
        }),
      ),
    ).toBe(403);
    const prepareKey = crypto.randomUUID();
    const prepared = CommandResultSchema.parse(
      await publicMovieHttpJson(
        await f.ownerBrowser.request(`${base}/subtitle-replacements`, {
          key: prepareKey,
          body: prepareBody,
        }),
        202,
      ),
    );
    const id = z.uuid().parse(prepared.subtitleReplacementId);
    const prepareCommand = await f.db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(prepared.operationId) },
      include: { outbox: true },
    });
    expect(prepareCommand.outbox).toMatchObject({
      kind: "prepare_subtitle_replacement",
      payload: prepareCommand.payload,
    });
    const preparedInput = Input.parse(prepareCommand.payload);
    expect(preparedInput.movieScope).toEqual(f.scope);
    expect(await f.invoke("prepareSubtitleReplacement", preparedInput)).toEqual(
      { state: "ready" },
    );
    await reviewAndApply(f, id, context);
    expect(await f.baseline()).toEqual(baseline);
    const after = await f.physical();
    expect(after.video).toEqual(physical.video);
    expect(after.chinese).toEqual(physical.chinese);
    expect(after.english.sha256).toBe(
      createHash("sha256").update(text).digest("hex"),
    );
    expect(after.english.sha256).not.toBe(physical.english.sha256);
    expect(await f.db.subtitleReplacement.count()).toBe(1);
    expect(
      await f.db.subtitleAsset.count({
        where: { assetId: context.assetId, providerId: "manual" },
      }),
    ).toBe(1);
    expect(f.http.errors).toEqual([]);
  } finally {
    await f.close();
  }
}, 60_000);

async function status(response: Promise<Response>) {
  const actual = await response;
  return actual.status;
}

async function reviewAndApply(
  f: Awaited<ReturnType<typeof createMovieReplacementHttpFixture>>,
  id: string,
  context: z.infer<typeof MovieSubtitleTargetV2Schema>,
) {
  const reviewUrl = `/api/v1/admin/subtitle-replacements/${id}`;
  expect(await status(f.memberBrowser.request(reviewUrl))).toBe(403);
  const review = SubtitleReplacementDetailSchema.parse(
    await publicMovieHttpJson(await f.ownerBrowser.request(reviewUrl)),
  );
  expect(review).toMatchObject({
    id,
    movieScope: f.scope,
    state: "awaiting_review",
    reservationActive: true,
    newProvider: "manual",
    newQuality: "accepted",
  });
  expect(review.destinationName).not.toContain("/");
  const row = await f.db.subtitleReplacement.findUniqueOrThrow({
    where: { id },
  });
  expect(MovieReplacementSnapshotV2Schema.parse(row.snapshot)).toMatchObject({
    scope: f.scope,
    source: { kind: "installation_v4" },
    asset: { id: context.assetId, version: context.version },
  });
  const approveBody = {
    expectedVersion: review.version,
    observationHash: z.string().parse(review.observationHash),
    acknowledgeReplacement: true,
  };
  expect(
    await status(
      f.memberBrowser.request(`${reviewUrl}/apply`, {
        key: crypto.randomUUID(),
        body: approveBody,
      }),
    ),
  ).toBe(403);
  const approved = CommandResultSchema.parse(
    await publicMovieHttpJson(
      await f.ownerBrowser.request(`${reviewUrl}/apply`, {
        key: crypto.randomUUID(),
        body: approveBody,
      }),
      202,
    ),
  );
  const applyCommand = await f.db.operation.findUniqueOrThrow({
    where: { id: z.uuid().parse(approved.operationId) },
  });
  const applyInput = Input.parse(applyCommand.payload);
  expect(applyInput.movieScope).toEqual(f.scope);
  expect(await f.invoke("applySubtitleReplacement", applyInput)).toEqual({
    state: "applied",
  });
  const complete = SubtitleReplacementDetailSchema.parse(
    await publicMovieHttpJson(await f.ownerBrowser.request(reviewUrl)),
  );
  expect(complete).toMatchObject({
    movieScope: f.scope,
    state: "applied",
    receiptOutcome: "installed",
    reservationActive: false,
  });
}
