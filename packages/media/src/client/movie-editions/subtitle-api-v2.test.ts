import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { queryClient, sessionBoundary } from "#client/api.ts";
import {
  member,
  owner,
  sessionFixture,
} from "#client/session.test-support.tsx";
import { MovieManualReplacementV2Schema } from "#shared/movie-editions/subtitle-replacement-v2.ts";
import { ApplySubtitleReplacementSchema } from "#shared/subtitle-replacement.ts";
import { writeSubtitleReplacementCommand } from "#client/subtitle-replacement/command.ts";
import { writeMovieCaptionV2 } from "./subtitle-api-v2.ts";

afterEach(() => {
  sessionBoundary.publish(
    null,
    sessionBoundary.getSnapshot().generation,
    "logout",
  );
  queryClient.clear();
  vi.unstubAllGlobals();
});

it("retries the exact named caption bytes and versions without storing subtitle content", async () => {
  const fixture = sessionFixture();
  sessionBoundary.publish(
    owner,
    sessionBoundary.getSnapshot().generation,
    "login",
  );
  const mediaId = crypto.randomUUID();
  const body = MovieManualReplacementV2Schema.parse({
    schemaVersion: 2,
    scope: { rootMediaId: mediaId, mediaId, edition: "directors_cut" },
    assetId: crypto.randomUUID(),
    expectedAssetVersion: 3,
    expectedChecksum: "a".repeat(64),
    language: "en",
    filename: "reviewed.srt",
    description: "Checked against this edition",
    contentBase64: btoa(
      "1\n00:00:01,000 --> 00:00:02,000\nThe reviewed caption.\n",
    ),
    confirmedMatchingVideo: true,
    replacementFor: {
      oldSubtitleId: crypto.randomUUID(),
      expectedOldVersion: 5,
    },
  });
  const input = {
    actorId: owner.id,
    path: `/media/${mediaId}/movie-editions/directors_cut/subtitle-replacements/candidates`,
    body,
  };
  const sent: { url: string; key: string | null; body: unknown }[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    sent.push({
      url,
      key: new Headers(init.headers).get("Idempotency-Key"),
      body: JSON.parse(z.string().parse(init.body)),
    });
    return sent.length === 1
      ? Promise.reject(new TypeError("Response lost after commit"))
      : Promise.resolve(
          Response.json({
            status: "completed",
            subtitleId: crypto.randomUUID(),
          }),
        );
  });
  await expect(writeMovieCaptionV2(input)).rejects.toThrow(
    "Response lost after commit",
  );
  expect(fixture.stored.size).toBe(1);
  expect(JSON.stringify([...fixture.stored])).not.toContain(body.contentBase64);
  await writeMovieCaptionV2(input);
  expect(sent[1]).toEqual(sent[0]);
  expect(sent[0]?.url).toBe(`/api/v2${input.path}`);
  expect(fixture.stored.size).toBe(0);
});

it("keeps the reviewed apply observation on retry and rejects reuse by another signed-in actor", async () => {
  sessionFixture();
  sessionBoundary.publish(
    owner,
    sessionBoundary.getSnapshot().generation,
    "login",
  );
  const input = {
    actorId: owner.id,
    id: crypto.randomUUID(),
    submission: {
      action: "apply" as const,
      body: ApplySubtitleReplacementSchema.parse({
        expectedVersion: 6,
        observationHash: "b".repeat(64),
        acknowledgeReplacement: true,
      }),
    },
  };
  const sent: { url: string; key: string | null; body: unknown }[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    sent.push({
      url,
      key: new Headers(init.headers).get("Idempotency-Key"),
      body: JSON.parse(z.string().parse(init.body)),
    });
    return sent.length === 1
      ? Promise.reject(new TypeError("Response lost"))
      : Promise.resolve(
          Response.json({ status: "queued", subtitleReplacementId: input.id }),
        );
  });
  await expect(writeSubtitleReplacementCommand(input)).rejects.toThrow(
    "Response lost",
  );
  await writeSubtitleReplacementCommand(input);
  expect(sent[1]).toEqual(sent[0]);
  expect(sent[0]?.url).toBe(
    `/api/v1/admin/subtitle-replacements/${input.id}/apply`,
  );
  expect(ApplySubtitleReplacementSchema.parse(sent[0]?.body)).toEqual(
    input.submission.body,
  );
  sessionBoundary.publish(
    member,
    sessionBoundary.getSnapshot().generation,
    "login",
  );
  await expect(writeSubtitleReplacementCommand(input)).rejects.toThrow();
  expect(sent).toHaveLength(2);
});
