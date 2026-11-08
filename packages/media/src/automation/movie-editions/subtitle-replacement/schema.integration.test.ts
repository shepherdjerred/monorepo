import { afterEach, beforeAll, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Prisma } from "#generated/prisma/client.ts";
import { createMovieReplacementFixture } from "#testing/movie-workflow/subtitles/subtitle-replacement-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import { replacementPaths } from "#automation/subtitle-replacement/files.ts";

let bytes: Uint8Array;
const closers: (() => Promise<void>)[] = [];
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
const hash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
type Fixture = Awaited<ReturnType<typeof createMovieReplacementFixture>>;

function authorizedTransaction(
  f: Fixture,
  action: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  const execution = testPublicationExecution();
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(
      execution.expiresAtMs,
      execution.observed.wall + 60_000,
    ),
    guards: [execution],
  });
  return f.db.$transaction(async (tx) => {
    await bindPlexTransactionDeadline(tx, freshness);
    await action(tx);
    freshness.assertActive();
  });
}

test("a valid original SQL deadline cannot substitute raw caption state for an actual replacement receipt", async () => {
  const f = await createMovieReplacementFixture("directors_cut", bytes);
  closers.push(f.close);
  const row = await f.row();
  const paths = replacementPaths(f.source.files.context, row);
  const before = await f.db.subtitleAsset.findMany({
    where: { assetId: f.asset.id },
    orderBy: { id: "asc" },
  });
  const original = await readFile(paths.target);
  await expect(
    authorizedTransaction(f, async (tx) => {
      await tx.$executeRaw`UPDATE "SubtitleAsset" SET state='installed', path=${f.old.path}, version=version+1 WHERE id=${f.candidate.id}`;
    }),
  ).rejects.toThrow(
    "Movie replacement native captions require their exact same-transaction receipt closure",
  );
  expect(
    await f.db.subtitleAsset.findMany({
      where: { assetId: f.asset.id },
      orderBy: { id: "asc" },
    }),
  ).toEqual(before);
  expect(await f.row()).toEqual(row);
  expect(hash(await readFile(paths.target))).toBe(hash(original));
  expect(
    await f.db.subtitleReplacementReceipt.count({
      where: { replacementId: row.id },
    }),
  ).toBe(0);
}, 60_000);

test("actual committed caption receipt, canonical-byte event and exact source command remain immutable with a valid SQL deadline", async () => {
  const f = await createMovieReplacementFixture("directors_cut", bytes);
  closers.push(f.close);
  const input = await f.approve();
  expect(await f.invoke("applySubtitleReplacement", input)).toEqual({
    state: "applied",
  });
  const row = await f.row();
  const event = await f.db.applicationEvent.findUniqueOrThrow({
    where: { dedupeKey: `movie-subtitle-replaced-v2:${row.id}` },
  });
  const command = await f.db.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  await expect(
    authorizedTransaction(f, async (tx) => {
      await tx.$executeRaw`DELETE FROM "SubtitleReplacementReceipt" WHERE "replacementId"=${row.id}`;
    }),
  ).rejects.toThrow();
  await expect(
    authorizedTransaction(f, async (tx) => {
      await tx.$executeRaw`UPDATE "ApplicationEvent" SET payload=jsonb_set(payload,'{receiptHash}',to_jsonb(${"0".repeat(64)}::text)) WHERE id=${event.id}`;
    }),
  ).rejects.toThrow("Movie replacement event source is immutable");
  await expect(
    authorizedTransaction(f, async (tx) => {
      await tx.$executeRaw`UPDATE "Operation" SET payload=jsonb_set(payload,'{movieScope,edition}','"extended_cut"'::jsonb) WHERE id=${command.id}`;
    }),
  ).rejects.toThrow(
    "Movie replacement command and original scope are immutable",
  );
  expect(await f.row()).toEqual(row);
  expect(
    await f.db.applicationEvent.findUniqueOrThrow({ where: { id: event.id } }),
  ).toEqual(event);
  expect(
    await f.db.operation.findUniqueOrThrow({ where: { id: command.id } }),
  ).toEqual(command);
  expect(await f.invoke("applySubtitleReplacement", input)).toEqual({
    state: "applied",
  });
}, 60_000);
