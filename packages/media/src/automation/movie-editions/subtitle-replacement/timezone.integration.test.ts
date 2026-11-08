import { afterEach, beforeAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createDatabase, type Database } from "#infrastructure/database.ts";
import { PrismaMovieSubtitleReplacements } from "#infrastructure/movie-editions/subtitle-replacement/service.ts";
import { readMovieReplacementReceiptV2 } from "#infrastructure/movie-editions/subtitle-replacement/records.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { createMovieReplacementFixture } from "#testing/movie-workflow/subtitles/subtitle-replacement-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { replacementPaths } from "#automation/subtitle-replacement/files.ts";
import { createMovieSubtitleReplacementFileFacet } from "./facet.ts";
import {
  createOutboxActivities,
  type WorkflowStart,
} from "#automation/store.ts";

const closers: (() => Promise<void>)[] = [];
let bytes: Uint8Array;
const hash = (input: Uint8Array) =>
  createHash("sha256").update(input).digest("hex");
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

/** This pool changes only its own PostgreSQL sessions, never stored history or process settings. */
async function localTimezoneDatabase(source: Database, timezone: string) {
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
      await source.$queryRaw`
      SELECT current_database() AS database,current_user AS "user",inet_server_port() AS port
    `,
    );
  if (address === undefined)
    throw new Error("Actual disposable database endpoint missing");
  const url = new URL(
    `postgresql://media@127.0.0.1:${String(address.port)}/postgres`,
  );
  url.searchParams.set("options", `-c timezone=${timezone}`);
  const db = createDatabase(url.toString());
  closers.push(() => db.$disconnect());
  expect(
    await db.$queryRaw`SELECT current_setting('TimeZone') AS timezone`,
  ).toEqual([{ timezone }]);
  return db;
}

async function assertImmediateDispatch(
  db: Database,
  expected: { operationId: string; replacementId: string },
) {
  const starts: WorkflowStart[] = [];
  await createOutboxActivities(db, (input) => {
    starts.push(input);
    return Promise.resolve();
  }).dispatchMediaOutbox();
  expect(starts).toContainEqual(
    expect.objectContaining({
      workflowId: `media-operation-${expected.operationId}`,
      input: expect.objectContaining(expected),
    }),
  );
}

test.each(["America/Los_Angeles", "Asia/Tokyo"])(
  "actual named replacement approval and native settlement retain UTC instants in %s sessions",
  async (timezone) => {
    const f = await createMovieReplacementFixture("directors_cut", bytes, {
      commandDatabase: (source) => localTimezoneDatabase(source, timezone),
    });
    closers.push(f.close);
    const db = f.commandDatabase;
    const context = { ...f.source.files.context, db };
    const bindingScope = { mediaId: f.scope.mediaId, edition: f.scope.edition };
    const facet = createMovieSubtitleReplacementFileFacet(context);
    const paths = replacementPaths(context, await f.row());
    const videoHash = hash(await readFile(paths.video));
    const oldHash = hash(await readFile(paths.target));
    const pointer = await db.plexBindingCurrent.findUniqueOrThrow({
      where: { mediaId_edition: bindingScope },
    });
    const parents = await db.operation.findMany({
      where: {
        kind: {
          in: ["reconcile_movie_edition_v4", "acquire_movie_subtitles_v4"],
        },
      },
      orderBy: { id: "asc" },
    });
    await assertImmediateDispatch(db, f.prepareInput);
    expect(
      await facet("prepareSubtitleReplacement", f.prepareInput, {
        execution: testPublicationExecution(),
        budget: new PublicationAuthorityReadBudget(),
      }),
    ).toEqual({ state: "ready" });
    const row = await f.row();
    const sections = await f.source.context.permittedSections();
    const service = new PrismaMovieSubtitleReplacements(
      db,
      {
        keepDays: 30,
        serverMachineId: z
          .string()
          .min(1)
          .parse(f.source.context.serverMachineId),
        movieSectionId: sections.movie,
      },
      (id) => f.describe.current(id),
    );
    const command = await service.review.apply(
      f.owner,
      crypto.randomUUID(),
      row.id,
      {
        expectedVersion: row.version,
        observationHash: z.string().parse(row.review?.observationHash),
        acknowledgeReplacement: true,
      },
    );
    expect(
      await db.$queryRaw`
      SELECT (r."approvedAt"<=clock_timestamp() AND r."expiresAt">clock_timestamp()) AS legacy,
        (r."approvedAt"<=(clock_timestamp() AT TIME ZONE 'UTC')
          AND r."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')) AS utc
      FROM "SubtitleReplacementReview" r WHERE r."replacementId"=${row.id}
    `,
    ).toEqual([{ legacy: false, utc: true }]);
    const budget = new PublicationAuthorityReadBudget();
    const input = {
      replacementId: row.id,
      operationId: z.uuid().parse(command.operationId),
      movieScope: f.scope,
    };
    await assertImmediateDispatch(db, input);
    expect(
      await facet("applySubtitleReplacement", input, {
        execution: testPublicationExecution(),
        budget,
      }),
    ).toEqual({ state: "applied" });
    expect(budget.take).toBeGreaterThan(0);
    const applied = await readMovieReplacementReceiptV2(
      db,
      row.id,
      new PublicationAuthorityReadBudget(),
    );
    if (applied === null)
      throw new Error("Actual native replacement settlement receipt missing");
    expect(applied.receipt.after.candidate).toMatchObject({
      id: f.candidate.id,
      state: "installed",
    });
    expect(applied.receipt.journal).toMatchObject({
      kind: "import",
      phase: "complete",
    });
    expect(
      await db.$queryRaw`
      SELECT (r."appliedAt"=(p.evidence->>'settledAt')::timestamptz) AS legacy,
        (r."appliedAt"=((p.evidence->>'settledAt')::timestamptz AT TIME ZONE 'UTC')) AS utc
      FROM "SubtitleReplacement" r JOIN "SubtitleReplacementReceipt" p ON p."replacementId"=r.id
      WHERE r.id=${row.id}
    `,
    ).toEqual([{ legacy: false, utc: true }]);
    expect(hash(await readFile(paths.target))).toBe(hash(Buffer.from(f.text)));
    expect(hash(await readFile(paths.oldArchive))).toBe(oldHash);
    expect(hash(await readFile(paths.video))).toBe(videoHash);
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toEqual(f.asset);
    expect(
      await db.plexBindingCurrent.findUniqueOrThrow({
        where: { mediaId_edition: bindingScope },
      }),
    ).toEqual(pointer);
    expect(
      await db.operation.findMany({
        where: { id: { in: parents.map((parent) => parent.id) } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(parents);
    expect(f.source.wire.additions()).toBe(1);
  },
  60_000,
);
