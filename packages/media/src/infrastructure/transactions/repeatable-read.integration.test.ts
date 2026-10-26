import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import {
  isRetryableTransaction,
  repeatableRead,
} from "#infrastructure/locks.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

async function account() {
  return cluster.database.mediaUser.create({
    data: { plexAccountId: crypto.randomUUID(), displayName: "Before" },
  });
}

test("a read snapshot retries the real PostgreSQL conflict and returns fresh rows with unchanged isolation", async () => {
  const user = await account();
  const db = cluster.database;
  let attempts = 0;
  const result = await repeatableRead(db, async (tx) => {
    attempts++;
    expect(await tx.$queryRaw`SHOW transaction_isolation`).toEqual([
      { transaction_isolation: "repeatable read" },
    ]);
    // Establish the real snapshot before a separate connection commits an update.
    await tx.mediaUser.findUniqueOrThrow({ where: { id: user.id } });
    if (attempts === 1)
      await db.mediaUser.update({
        where: { id: user.id },
        data: { displayName: "After" },
      });
    return tx.$queryRaw<{ id: string; displayName: string }[]>`
      SELECT id,"displayName" FROM "MediaUser" WHERE id=${user.id} FOR SHARE`;
  });
  expect(attempts).toBe(2);
  expect(result).toEqual([{ id: user.id, displayName: "After" }]);
});

test("continual committed interference exhausts exactly four snapshots instead of retrying indefinitely", async () => {
  const user = await account();
  const db = cluster.database;
  let attempts = 0;
  let failure: unknown;
  try {
    await repeatableRead(db, async (tx) => {
      attempts++;
      await tx.mediaUser.findUniqueOrThrow({ where: { id: user.id } });
      await db.mediaUser.update({
        where: { id: user.id },
        data: { displayName: `Committed ${String(attempts)}` },
      });
      await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id=${user.id} FOR SHARE`;
    });
  } catch (error) {
    failure = error;
  }
  expect(isRetryableTransaction(failure)).toBe(true);
  expect(attempts).toBe(4);
  expect(
    await db.mediaUser.findUniqueOrThrow({ where: { id: user.id } }),
  ).toMatchObject({ displayName: "Committed 4" });
});

test("an unrelated contract failure is returned unchanged without a second read", async () => {
  const failure = new Error("Invalid internal read contract");
  let attempts = 0;
  await expect(
    repeatableRead(cluster.database, () => {
      attempts++;
      return Promise.reject(failure);
    }),
  ).rejects.toBe(failure);
  expect(attempts).toBe(1);
});
