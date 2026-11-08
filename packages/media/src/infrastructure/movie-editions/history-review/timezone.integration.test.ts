import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createMovieHistoryFixture } from "#testing/movie-workflow/history/history-review-fixture.ts";
import { createDatabase, type Database } from "#infrastructure/database.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { PrismaMovieHistoryReviews } from "./service.ts";
import {
  MovieHistoryDetailV3Schema,
  MovieHistoryPersonalDetailV3Schema,
} from "#shared/movie-editions/history-review-v3.ts";

let bytes: Uint8Array;
const closers: (() => Promise<void>)[] = [];
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

/** A separate real pool supplies a startup TimeZone; no process/global setting or stored timestamp changes. */
async function localTimezoneDatabase(db: Database, timezone: string) {
  const [address] = z
    .array(
      z.strictObject({
        database: z.literal("postgres"),
        user: z.literal("media"),
        port: z.int().positive(),
      }),
    )
    .length(1)
    .parse(
      await db.$queryRaw`
    SELECT current_database() AS database,current_user AS "user",inet_server_port() AS port
  `,
    );
  if (address === undefined)
    throw new Error("Actual disposable database endpoint missing");
  const url = new URL(
    `postgresql://media@127.0.0.1:${String(address.port)}/postgres`,
  );
  url.searchParams.set("options", `-c timezone=${timezone}`);
  const database = createDatabase(url.toString());
  closers.push(() => database.$disconnect());
  const observed = z
    .array(z.strictObject({ timezone: z.string() }))
    .length(1)
    .parse(
      await database.$queryRaw`SELECT current_setting('TimeZone') AS timezone`,
    );
  expect(observed[0]?.timezone).toBe(timezone);
  return database;
}

test.each(["America/Los_Angeles", "Asia/Tokyo"])(
  "actual choice, Keep and complete history release use exact UTC instants with %s PostgreSQL sessions",
  async (timezone) => {
    const f = await createMovieHistoryFixture("directors_cut", bytes);
    closers.push(f.close);
    const db = await localTimezoneDatabase(f.db, timezone);
    const member = f.household.find((person) => person.id !== f.owner.id);
    if (member === undefined)
      throw new Error("Actual applicable independent member missing");
    const reads = new PrismaMediaApplication(db, f.settings);
    const commands = new MovieLifecycleCommands(db, f.settings);
    const service = new PrismaMovieHistoryReviews(db, f.settings);
    const context = await reads.getMovieEditionContextV4(
      member,
      f.scope.mediaId,
      member.id,
    );
    const selected = context.options.find(
      (option) => option.edition === f.scope.edition,
    );
    if (selected === undefined) throw new Error("Current selected cut missing");
    const request = await commands.requestMovieEditionV4(
      member,
      crypto.randomUUID(),
      {
        schemaVersion: 4,
        mediaId: f.scope.mediaId,
        subjectUserId: member.id,
        expected: {
          mediaVersion: context.mediaVersion,
          targetVersion: selected.targetVersion,
          definition: selected.storedDefinition,
          request:
            selected.request === null
              ? null
              : {
                  id: selected.request.id,
                  version: selected.request.version,
                  choiceRevision: selected.request.choiceRevision,
                },
        },
        selection: {
          edition: selected.edition,
          definitionVersion: selected.definitionVersion,
          definitionDigest: selected.definitionDigest,
          registryVersion: context.registryVersion,
        },
        options: { subtitleLanguages: ["en"] },
      },
    );
    const target = await reads.getMovieTargetContextV4(member, f.scope);
    await commands.executeMovieLifecycleV4(member, crypto.randomUUID(), {
      schemaVersion: 4,
      scope: f.scope,
      expected: target.expected,
      command: { action: "keep" },
    });
    const preparing = await service.context(f.owner, f.scope);
    const captured = await service.prepare(
      f.owner,
      crypto.randomUUID(),
      preparing,
    );
    const review = MovieHistoryDetailV3Schema.parse(
      await service.detail(f.owner, captured.recoveryReviewId),
    );
    expect(review.scope.requests).toHaveLength(1);
    expect(review.scope.personalHolds).toHaveLength(1);
    const shifted = {
      ...review.scope,
      requests: review.scope.requests.map((row) => ({
        ...row,
        createdAt: new Date(
          Date.parse(row.createdAt) + 3_600_000,
        ).toISOString(),
      })),
    };
    expect(
      await db.$queryRaw`SELECT media_movie_history_inventory_v3(${JSON.stringify(shifted)}::jsonb) AS valid`,
    ).toEqual([{ valid: false }]);
    for (const person of f.household) {
      const declaration =
        person.id === member.id
          ? await memberKeepDeclaration(service, member, {
              reviewId: review.id,
              requestId: request.requestId,
              choiceId: request.choiceId,
            })
          : { intent: "no_longer_request" as const };
      const subject = review.scope.users.find((row) => row.id === person.id);
      if (subject === undefined)
        throw new Error("Actual review omitted an applicable person");
      await service.respond(person, crypto.randomUUID(), review.id, {
        schemaVersion: 3,
        scope: f.scope,
        scopeHash: review.scopeHash,
        subjectUserId: person.id,
        definition: review.scope.definition,
        registryVersion: 1,
        declaration,
        claimAcknowledgements: subject.claimAcknowledgements,
        acknowledgeMissingHistory: true,
      });
    }
    const ready = MovieHistoryDetailV3Schema.parse(
      await service.detail(f.owner, review.id),
    );
    const released = await service.release(
      f.owner,
      crypto.randomUUID(),
      ready.id,
      {
        schemaVersion: 3,
        scope: f.scope,
        expectedVersion: ready.version,
        scopeHash: ready.scopeHash,
        responseHash: ready.responseHash,
        confirmHouseholdBaseline: true,
        confirmExistingPins: true,
        acknowledgeMissingHistory: true,
      },
    );
    expect(released.recoveryReceiptId).toBeDefined();
    expect(
      await db.retentionHold.count({
        where: {
          mediaId: f.scope.mediaId,
          edition: f.scope.edition,
          userId: member.id,
        },
      }),
    ).toBe(1);
    expect(
      await db.recoveryHold.findUniqueOrThrow({
        where: {
          mediaId_edition: {
            mediaId: f.scope.mediaId,
            edition: f.scope.edition,
          },
        },
      }),
    ).toMatchObject({
      releaseEvidence: {
        receiptId: released.recoveryReceiptId,
        scope: f.scope,
      },
    });
  },
  60_000,
);

async function memberKeepDeclaration(
  service: PrismaMovieHistoryReviews,
  member: Awaited<ReturnType<typeof createMovieHistoryFixture>>["owner"],
  input: { reviewId: string; requestId: string; choiceId: string },
) {
  const personal = MovieHistoryPersonalDetailV3Schema.parse(
    await service.detail(member, input.reviewId),
  );
  const request = personal.requests.find((row) => row.id === input.requestId);
  const choice = personal.choices.find((row) => row.id === input.choiceId);
  const keep = personal.personalHolds[0];
  if (request === undefined || choice === undefined || keep === undefined)
    throw new Error("Actual captured request, choice or Keep missing");
  return {
    intent: "keep" as const,
    currentChoice: {
      requestId: request.id,
      requestVersion: request.version,
      choiceId: choice.id,
      choiceRevision: choice.choiceRevision,
      subtitleLanguages: request.subtitleLanguages,
    },
    currentKeep: keep,
  };
}
