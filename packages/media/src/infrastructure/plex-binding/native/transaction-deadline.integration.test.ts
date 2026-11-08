import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const operationId = crypto.randomUUID();
const originalResult = {
  historical: "literal test fixture; no association receipt",
};

function freshness(duration = 10_000) {
  const wall = Date.now();
  return plexBindingFreshness({
    observed: { wall, monotonic: performance.now() },
    expiresAtMs: wall + duration,
    guards: [],
  });
}

beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  await cluster.database.operation.create({
    data: {
      id: operationId,
      kind: "reconcile_media",
      payload: {},
      result: originalResult,
    },
  });
  await cluster.database.$executeRawUnsafe(
    `CREATE SEQUENCE test_deadline_deferred_visits`,
  );
  await cluster.database.$executeRawUnsafe(`
    CREATE FUNCTION test_deadline_deferred_sleep() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF current_setting('media.test_deadline_sleep',true) = 'on' THEN
        PERFORM nextval('test_deadline_deferred_visits');
        PERFORM pg_sleep(GREATEST(0, NEW."deadlineMs" / 1000.0 - extract(epoch FROM clock_timestamp())) + 0.025);
      END IF;
      RETURN NULL;
    END;
    $$`);
  // PostgreSQL orders same-event triggers by name: this sleeper is queued first.
  await cluster.database.$executeRawUnsafe(`
    CREATE CONSTRAINT TRIGGER a_test_deadline_sleep
    AFTER INSERT OR UPDATE ON "PlexDeadlineValidation"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION test_deadline_deferred_sleep()`);
}, 60_000);

afterEach(async () => {
  expect(
    await cluster.database.$queryRaw`SELECT * FROM "PlexDeadlineValidation"`,
  ).toEqual([]);
  const operation = await cluster.database.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  expect(operation.result).toEqual(originalResult);
});
afterAll(async () => {
  await cluster.close();
});

test("successful bound transaction leaves no work or historical changes and retains the earliest minimum", async () => {
  await cluster.database.$transaction(async (tx) => {
    const original = freshness();
    await bindPlexTransactionDeadline(tx, original);
    await bindPlexTransactionDeadline(tx, freshness(20_000));
    const rows = await tx.$queryRaw<
      { deadlineMs: bigint; configured: string }[]
    >`
      SELECT "deadlineMs",current_setting('media.plex_deadline_ms') AS configured
      FROM "PlexDeadlineValidation" WHERE "transactionId"=txid_current()`;
    expect(rows).toEqual([
      {
        deadlineMs: BigInt(original.expiresAtMs),
        configured: String(original.expiresAtMs),
      },
    ]);
    const reduced = freshness(5000);
    await bindPlexTransactionDeadline(tx, reduced);
    expect(
      await tx.$queryRaw`SELECT "deadlineMs" FROM "PlexDeadlineValidation" WHERE "transactionId"=txid_current()`,
    ).toEqual([{ deadlineMs: BigInt(reduced.expiresAtMs) }]);
    original.assertActive();
    reduced.assertActive();
  });
});

test.each([false, true])(
  "deferred work after the last JS check rolls back completion even with deleted work=%s",
  async (deleteWork) => {
    const before = await cluster.database.$queryRaw<
      { last_value: bigint; is_called: boolean }[]
    >`
    SELECT last_value,is_called FROM test_deadline_deferred_visits`;
    let lastJavaScriptCheck = false;
    await expect(
      cluster.database.$transaction(async (tx) => {
        const original = freshness(500);
        await bindPlexTransactionDeadline(tx, original);
        await tx.operation.update({
          where: { id: operationId },
          data: { result: { terminal: true } },
        });
        await tx.$queryRaw`SELECT set_config('media.test_deadline_sleep','on',true)`;
        if (deleteWork)
          await tx.$executeRaw`DELETE FROM "PlexDeadlineValidation" WHERE "transactionId"=txid_current()`;
        original.assertActive();
        lastJavaScriptCheck = true;
      }),
    ).rejects.toThrow("deadline");
    expect(lastJavaScriptCheck).toBe(true);
    // Sequence changes survive rollback: the actual DEFERRED sleeper ran, rather
    // than a JS or immediate SQL check rejecting before COMMIT was attempted.
    const after = await cluster.database.$queryRaw<
      { last_value: bigint; is_called: boolean }[]
    >`
    SELECT last_value,is_called FROM test_deadline_deferred_visits`;
    expect(after[0]?.is_called).toBe(true);
    expect(after).not.toEqual(before);
  },
);

test("later SQL setting renewal cannot bypass an earlier captured event after delete and rebind", async () => {
  await expect(
    cluster.database.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness());
      await tx.$executeRaw`DELETE FROM "PlexDeadlineValidation" WHERE "transactionId"=txid_current()`;
      await tx.$queryRaw`SELECT set_config('media.plex_deadline_ms',${String(Date.now() + 20_000)},true)`;
      await bindPlexTransactionDeadline(tx, freshness(20_000));
    }),
  ).rejects.toThrow("extended after capture");
});

test("existing work deadline cannot grow or change transaction identity", async () => {
  await expect(
    cluster.database.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness());
      await tx.$executeRaw`UPDATE "PlexDeadlineValidation" SET "deadlineMs"="deadlineMs"+1 WHERE "transactionId"=txid_current()`;
    }),
  ).rejects.toThrow("only shrink");
  await expect(
    cluster.database.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness());
      await tx.$executeRaw`UPDATE "PlexDeadlineValidation" SET "transactionId"="transactionId"+1 WHERE "transactionId"=txid_current()`;
    }),
  ).rejects.toThrow("only shrink");
});

test("foreign transaction work is rejected at commit", async () => {
  await expect(
    cluster.database.$transaction(async (tx) => {
      const deadline = Date.now() + 10_000;
      await tx.$queryRaw`SELECT set_config('media.plex_deadline_ms',${String(deadline)},true)`;
      await tx.$executeRaw`INSERT INTO "PlexDeadlineValidation" VALUES (txid_current()+1,${BigInt(deadline)})`;
    }),
  ).rejects.toThrow("another transaction");
});

test.each(["", "malformed", "0"])(
  "missing, malformed or expired SQL setting %s protects captured work",
  async (setting) => {
    await expect(
      cluster.database.$transaction(async (tx) => {
        await bindPlexTransactionDeadline(tx, freshness());
        await tx.$queryRaw`SELECT set_config('media.plex_deadline_ms',${setting},true)`;
      }),
    ).rejects.toThrow("deadline");
  },
);
