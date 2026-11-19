/** Extended-only fixture: real personal commands, coverage projection and tracker parsing. */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { automationTestHarness } from "#testing/automation.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { RequestInterestCommands } from "#infrastructure/request-interest/commands.ts";
import { createCoverageActivities } from "#automation/reconciliation/coverage.ts";
import { KnabenProvider } from "#integrations/providers.ts";
import {
  loadProfile,
  searchCandidates,
} from "#automation/acquisition-candidates.ts";
import { reserveCandidate } from "#automation/acquisition-reservation.ts";
import { assertAttemptIdentity } from "#infrastructure/acquisition-identity/authority.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";

export async function followingCoverageFixture(
  harness: ReturnType<typeof automationTestHarness>,
) {
  const base = await harness.fixture();
  const db = harness.database();
  const owner = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Owner",
      role: "owner",
    },
  });
  const commands = new PrismaMediaCommands(db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
  });
  const currentDefault = await db.qualityProfileDefault.findUnique({
    where: { kind: "series" },
  });
  await commands.setProfileDefault(owner, crypto.randomUUID(), "series", {
    profileId: base.profile.id,
    expectedVersion: currentDefault?.version ?? 0,
  });
  const series = await db.mediaItem.create({
    data: {
      kind: "series",
      title: "Followed Series",
      year: 2020,
      catalogState: "ready",
    },
  });
  const episodes = await Promise.all(
    [1, 2].map((episodeNumber) =>
      db.mediaItem.create({
        data: {
          kind: "episode",
          title: `Episode ${String(episodeNumber)}`,
          parentId: series.id,
          seasonNumber: 1,
          episodeNumber,
          runtimeMinutes: 45,
          originalLanguage: "en",
        },
      }),
    ),
  );
  const episode = episodes[0];
  if (episode === undefined) throw new Error("First episode missing");
  const direct = await commands.createRequest(base.user, crypto.randomUUID(), {
    mediaId: episode.id,
    subtitleLanguages: ["en"],
    includeSpecials: false,
    keepingPolicy: "temporary",
  });
  const interests = new RequestInterestCommands(db, { keepDays: 30 });
  const change = async (requestId: string, action: "finished" | "drop") => {
    const request = await db.mediaRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    return interests.execute(base.user, crypto.randomUUID(), {
      schemaVersion: 1,
      requestId,
      expectedVersion: request.version,
      expectedInterestRevision: request.interestRevision,
      action,
    });
  };
  await change(z.uuid().parse(direct.requestId), "finished");
  const finished = await db.mediaRequest.findUniqueOrThrow({
    where: { id: z.uuid().parse(direct.requestId) },
  });
  const following = await commands.createRequest(
    base.user,
    crypto.randomUUID(),
    {
      mediaId: series.id,
      subtitleLanguages: ["en"],
      includeSpecials: false,
      includeFutureEpisodes: true,
      keepingPolicy: "temporary",
    },
  );
  const root = await db.mediaRequest.findUniqueOrThrow({
    where: { id: z.uuid().parse(following.requestId) },
  });
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: z.uuid().parse(following.operationId) },
  });
  await createCoverageActivities({ db }).expandMediaRequest({
    ...z
      .object({
        requestId: z.uuid(),
        requestVersion: z.int(),
        cursor: z.string().nullable(),
      })
      .parse(operation.payload),
    operationId: operation.id,
  });
  const context = harness.context();
  const hash = randomBytes(20).toString("hex");
  const provider = new KnabenProvider(() =>
    Promise.resolve(
      Response.json({
        hits: [
          {
            id: crypto.randomUUID(),
            title: "Followed.Series.2020.S01E01E02.1080p.WEB-DL.H264.ENG",
            bytes: 2000,
            seeders: 100,
            hash,
            details: "https://example.com",
            magnetUrl: `magnet:?xt=urn:btih:${hash}`,
            link: null,
          },
        ],
      }),
    ),
  );
  context.providers = { withProvider: async (_id, work) => work(provider) };
  const reserve = async () => {
    const profile = await loadProfile(db, episode.id);
    if (profile === null)
      throw new Error("Following root did not assign its profile");
    const candidates = await searchCandidates(context, episode.id, profile);
    if (candidates.length !== 1)
      throw new Error("Actual parsed pack candidate missing");
    const command = await db.operation.findUniqueOrThrow({
      where: {
        idempotencyKey: `coverage:${root.id}:${String(root.version)}:${episode.id}`,
      },
    });
    const input = z
      .object({ operationId: z.uuid(), mediaId: z.uuid(), generation: z.int() })
      .parse(command.payload);
    return reserveCandidate(context, input, {
      releaseId: z.uuid().parse(candidates[0]),
      profile,
      epoch: 0,
    });
  };
  const recheck = async (attemptId: string) => {
    const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    return db.$transaction(async (tx) => {
      await lockAcquisitionMedia(tx, attempt.mediaIds);
      await lockEffectiveRequests(tx, attempt.mediaIds);
      if (!(await lockRuntimeAuthority(tx, attempt.recoveryEpoch)))
        throw new Error("Native fixture lost runtime authority");
      return assertAttemptIdentity(tx, attempt, {
        serverMachineId: "fixture-server",
      });
    });
  };
  return {
    db,
    owner,
    user: base.user,
    series,
    episodes,
    episode,
    root,
    finished,
    commands,
    change,
    reserve,
    recheck,
  };
}
