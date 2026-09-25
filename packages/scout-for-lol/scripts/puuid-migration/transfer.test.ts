import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { openFixtureDatabase, removeDatabase } from "./sqlite-fixture.ts";

const dbPath = path.join(tmpdir(), "puuid-migration-transfer-test.sqlite");
process.env["DATABASE_URL"] = `file:${dbPath}`;

const OLD_A = `OLDA_${"a".repeat(73)}`;
const OLD_B = `OLDB_${"b".repeat(73)}`;
const NEW_A = `NEWA_${"y".repeat(73)}`;
const NEW_B = `NEWB_${"z".repeat(73)}`;

const generatedPuuid = (prefix: string, index: number): string => {
  const stem = `${prefix}_${index.toString().padStart(6, "0")}`;
  return `${stem}${prefix
    .toLowerCase()
    .repeat(78)
    .slice(0, 78 - stem.length)}`;
};

/** One exported line for OLD_A with no replacement, for a given reason. */
const lostLine = (status: string): string =>
  JSON.stringify({
    oldPuuid: OLD_A,
    gameName: null,
    tagLine: null,
    newPuuid: null,
    status,
  });

/** One exported mapping line for OLD_A, pointing wherever the test needs. */
const mapLine = (newPuuid: string): string =>
  JSON.stringify({
    oldPuuid: OLD_A,
    gameName: "N",
    tagLine: "T",
    newPuuid,
    status: "resolved",
  });

const remove = (): Promise<void> => removeDatabase(dbPath);

async function open() {
  const db = await openFixtureDatabase(dbPath);
  const { ensureMapTable } = await import("./map-table.ts");
  await ensureMapTable(db);
  return db;
}

beforeEach(remove);
afterAll(remove);

test("seed adds identities from an inventory and reports what it skipped", async () => {
  const db = await open();
  const { seedIdentities } = await import("./transfer.ts");
  const first = await seedIdentities(db, [OLD_A, OLD_B]);
  expect(first).toEqual({ added: 2, alreadyKnown: 0 });
  const again = await seedIdentities(db, [OLD_A, OLD_B]);
  expect(again).toEqual({
    added: 0,
    alreadyKnown: 2,
  });
  await db.close();
});

test("seed records a previous migration result as the next transition's input", async () => {
  // The previous result is the next transition's old-domain value. Skipping it
  // would make a successive migration silently resolve nothing.
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status") VALUES (${db.param(1)}, ${db.param(2)}, 'resolved')`,
    [OLD_A, NEW_A],
  );
  const { seedIdentities } = await import("./transfer.ts");
  const result = await seedIdentities(db, [NEW_A]);
  expect(result).toEqual({
    added: 1,
    alreadyKnown: 0,
  });
  await db.close();
});

test("seeding a stale transition's map records every next-transition identity", async () => {
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status") VALUES (${db.param(1)}, ${db.param(2)}, 'resolved')`,
    [OLD_A, NEW_A],
  );
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status") VALUES (${db.param(1)}, ${db.param(2)}, 'resolved')`,
    [OLD_B, NEW_B],
  );
  const { seedIdentities } = await import("./transfer.ts");
  const result = await seedIdentities(db, [NEW_A, NEW_B]);
  expect(result).toEqual({
    added: 2,
    alreadyKnown: 0,
  });
  await db.close();
});

test("a map survives export and import into another database", async () => {
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "gameName", "tagLine", "newPuuid", "status")
     VALUES (${db.param(1)}, 'Zozio8z', 'EUW', ${db.param(2)}, 'resolved')`,
    [OLD_A, NEW_A],
  );
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "status") VALUES (${db.param(1)}, 'stranded')`,
    [OLD_B],
  );
  const { exportMap, serializeMap, parseMapRows } =
    await import("./transfer.ts");
  const rows = await exportMap(db);
  expect(parseMapRows(serializeMap(rows))).toEqual(rows);
  await db.close();
});

test("import does not carry appliedAt, which is a fact about the target", async () => {
  // Whether a mapping's rewrite has landed is true of one database at a time.
  // Importing it would tell the report lake to publish a translation the stored
  // columns do not hold yet.
  const db = await open();
  const { importMap } = await import("./transfer.ts");
  const result = await importMap(db, [
    {
      oldPuuid: OLD_A,
      gameName: "Zozio8z",
      tagLine: "EUW",
      newPuuid: NEW_A,
      status: "resolved",
    },
  ]);
  expect(result).toEqual({ inserted: 1, updated: 0, downgraded: 0 });
  const rows = await db.query(
    `SELECT "appliedAt" AS v, "newPuuid" AS n FROM "PuuidKeyMap"`,
  );
  expect(rows[0]?.["v"]).toBeNull();
  expect(rows[0]?.["n"]).toBe(NEW_A);
  await db.close();
});

// 2,002 upserts against a real SQLite file: milliseconds locally, but about 12
// seconds on a CI runner's disk, past Vitest's 5-second default.
test("import batches new rows and remains resumable across batch boundaries", async () => {
  const db = await open();
  const { importMap } = await import("./transfer.ts");
  const incoming = Array.from({ length: 1001 }, (_, index) => ({
    oldPuuid: generatedPuuid("O", index),
    gameName: `Player${index.toString()}`,
    tagLine: "TEST",
    newPuuid: generatedPuuid("N", index),
    status: "resolved",
  }));

  expect(await importMap(db, incoming)).toEqual({
    inserted: 1001,
    updated: 0,
    downgraded: 0,
  });
  expect(await importMap(db, incoming)).toEqual({
    inserted: 0,
    updated: 1001,
    downgraded: 0,
  });
  const rows = await db.query(
    `SELECT COUNT(*) AS n FROM "PuuidKeyMap" WHERE "status" = 'resolved'`,
  );
  expect(Number(rows[0]?.["n"])).toBe(1001);
  await db.close();
}, 60_000);

test("import accepts PostgreSQL Date values from unrelated applied rows", async () => {
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status", "appliedAt") VALUES (${db.param(1)}, ${db.param(2)}, 'resolved', datetime('now'))`,
    [OLD_A, NEW_A],
  );
  const postgresShaped = {
    ...db,
    query: async (sql: string, params?: Parameters<typeof db.query>[1]) => {
      const rows = await db.query(sql, params);
      if (!sql.includes('FROM "PuuidKeyMap"')) return rows;
      return rows.map((row) => ({
        ...row,
        appliedAt:
          typeof row["appliedAt"] === "string"
            ? new Date(row["appliedAt"])
            : row["appliedAt"],
      }));
    },
  };
  const { importMap } = await import("./transfer.ts");

  await expect(
    importMap(postgresShaped, [
      {
        oldPuuid: OLD_B,
        gameName: "New",
        tagLine: "TEST",
        newPuuid: NEW_B,
        status: "resolved",
      },
    ]),
  ).resolves.toEqual({ inserted: 1, updated: 0, downgraded: 0 });
  await db.close();
});

test("export carries only the current unapplied transition delta", async () => {
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status", "appliedAt") VALUES (${db.param(1)}, ${db.param(2)}, 'resolved', datetime('now'))`,
    [OLD_A, NEW_A],
  );
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "status") VALUES (${db.param(1)}, 'pending')`,
    [OLD_B],
  );
  const { exportMap } = await import("./transfer.ts");
  const rows = await exportMap(db);
  expect(rows.map((row) => row.oldPuuid)).toEqual([OLD_B]);
  await db.close();
});

test("import updates an existing row, because the imported map is the newer answer", async () => {
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "status") VALUES (${db.param(1)}, 'pending')`,
    [OLD_A],
  );
  const { importMap } = await import("./transfer.ts");
  const result = await importMap(db, [
    {
      oldPuuid: OLD_A,
      gameName: "Zozio8z",
      tagLine: "EUW",
      newPuuid: NEW_A,
      status: "resolved",
    },
  ]);
  expect(result).toEqual({ inserted: 0, updated: 1, downgraded: 0 });
  const rows = await db.query(
    `SELECT "status" AS s, "newPuuid" AS n FROM "PuuidKeyMap"`,
  );
  expect(rows[0]?.["s"]).toBe("resolved");
  expect(rows[0]?.["n"]).toBe(NEW_A);
  await db.close();
});

test("import permits a new edge after a return transition and resets its applied marker", async () => {
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status", "appliedAt") VALUES
      (${db.param(1)}, ${db.param(2)}, 'resolved', datetime('now', '-2 days')),
      (${db.param(2)}, ${db.param(1)}, 'resolved', datetime('now', '-1 day'))`,
    [OLD_A, NEW_A],
  );
  const { importMap } = await import("./transfer.ts");
  const result = await importMap(db, [
    {
      oldPuuid: OLD_A,
      gameName: "N",
      tagLine: "T",
      newPuuid: NEW_B,
      status: "resolved",
    },
  ]);
  expect(result).toEqual({ inserted: 0, updated: 1, downgraded: 0 });
  const rows = await db.query(
    `SELECT "newPuuid" AS n, "appliedAt" AS a FROM "PuuidKeyMap" WHERE "oldPuuid" = ${db.param(1)}`,
    [OLD_A],
  );
  expect(rows[0]?.["n"]).toBe(NEW_B);
  expect(rows[0]?.["a"]).toBeNull();
  await db.close();
});

test("import preserves an applied edge when a reused source is unresolved", async () => {
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status", "appliedAt") VALUES (${db.param(1)}, ${db.param(2)}, 'resolved', datetime('now', '-1 day'))`,
    [OLD_A, NEW_A],
  );
  const { importMap } = await import("./transfer.ts");
  await importMap(db, [
    {
      oldPuuid: OLD_A,
      gameName: null,
      tagLine: null,
      newPuuid: null,
      status: "unresolved",
    },
  ]);
  const current = await db.query(
    `SELECT "newPuuid" AS n, "status" AS s, "appliedAt" AS a FROM "PuuidKeyMap"`,
  );
  expect(current[0]?.["n"]).toBeNull();
  expect(current[0]?.["s"]).toBe("unresolved");
  expect(current[0]?.["a"]).toBeNull();
  const history = await db.query(
    `SELECT "oldPuuid", "newPuuid" FROM "PuuidKeyMapHistory"`,
  );
  expect(history).toEqual([{ oldPuuid: OLD_A, newPuuid: NEW_A }]);
  await db.close();
});

describe("a map file is parsed, not trusted", () => {
  // It crosses machines. `apply` rewrites every stored reference to whatever is
  // in it, and `verify` would pass afterwards because it only asks whether a
  // replacement exists and the old value is gone — so a corrupted row replaces
  // real identities across two databases and an archive and reports success.
  const good = {
    oldPuuid: OLD_A,
    gameName: "Zozio8z",
    tagLine: "EUW",
    newPuuid: NEW_A,
    status: "resolved",
  };
  const line = (over: Record<string, unknown>) =>
    JSON.stringify({ ...good, ...over });

  test("accepts a well-formed mapping", async () => {
    const { parseMapRows } = await import("./transfer.ts");
    expect(parseMapRows(line({}))).toHaveLength(1);
  });

  test("refuses a replacement that is not a PUUID", async () => {
    const { parseMapRows } = await import("./transfer.ts");
    expect(() => parseMapRows(line({ newPuuid: "x" }))).toThrow(/not a PUUID/);
  });

  test("refuses an identity that is not a PUUID", async () => {
    const { parseMapRows } = await import("./transfer.ts");
    expect(() => parseMapRows(line({ oldPuuid: "x" }))).toThrow(/not a PUUID/);
  });

  test("refuses a status nothing understands", async () => {
    const { parseMapRows } = await import("./transfer.ts");
    expect(() => parseMapRows(line({ status: "probably-fine" }))).toThrow(
      /status/,
    );
  });

  test("refuses a resolved row with nothing to rewrite to", async () => {
    const { parseMapRows } = await import("./transfer.ts");
    expect(() =>
      parseMapRows(line({ newPuuid: null, status: "resolved" })),
    ).toThrow(/resolved exactly when/);
  });

  test("refuses a replacement the gates would read as unfinished", async () => {
    const { parseMapRows } = await import("./transfer.ts");
    expect(() => parseMapRows(line({ status: "pending" }))).toThrow(
      /resolved exactly when/,
    );
  });

  test("accepts a stranded row, which has no replacement by definition", async () => {
    const { parseMapRows } = await import("./transfer.ts");
    const rows = parseMapRows(
      line({
        newPuuid: null,
        status: "stranded",
        gameName: null,
        tagLine: null,
      }),
    );
    expect(rows[0]?.status).toBe("stranded");
  });

  test("names the line it could not read", async () => {
    const { parseMapRows } = await import("./transfer.ts");
    expect(() =>
      parseMapRows(`${line({})}\n${line({ newPuuid: "x" })}`),
    ).toThrow(/line 2/);
  });
});

test("import never erases a replacement this database already holds", async () => {
  // An identity the earlier migration resolved can fail to resolve now, because
  // the account was deleted in between. The old mapping is still correct for
  // every object already written, and nothing can rebuild it once the old key
  // is gone — Riot forgetting an account does not unmake the identifier it used
  // to have.
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status") VALUES (${db.param(1)}, ${db.param(2)}, 'resolved')`,
    [OLD_A, NEW_A],
  );
  const { importMap } = await import("./transfer.ts");
  await importMap(db, [
    {
      oldPuuid: OLD_A,
      gameName: null,
      tagLine: null,
      newPuuid: null,
      status: "unresolved",
    },
  ]);
  const rows = await db.query(
    `SELECT "newPuuid" AS n, "status" AS s FROM "PuuidKeyMap"`,
  );
  expect(rows[0]?.["n"]).toBe(NEW_A);
  expect(rows[0]?.["s"]).toBe("resolved");
  await db.close();
});

test("import still upgrades an unresolved row when a replacement arrives", async () => {
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "status") VALUES (${db.param(1)}, 'unresolved')`,
    [OLD_A],
  );
  const { importMap } = await import("./transfer.ts");
  await importMap(db, [
    {
      oldPuuid: OLD_A,
      gameName: "Zozio8z",
      tagLine: "EUW",
      newPuuid: NEW_A,
      status: "resolved",
    },
  ]);
  const rows = await db.query(
    `SELECT "newPuuid" AS n, "status" AS s FROM "PuuidKeyMap"`,
  );
  expect(rows[0]?.["n"]).toBe(NEW_A);
  expect(rows[0]?.["s"]).toBe("resolved");
  await db.close();
});

test("a replacement equal to its own identifier is refused", async () => {
  // `resolve` already treats an unchanged identifier as proof both credentials
  // share a key domain. Here it is worse: for a participant who appears only in
  // the archive, `apply` and `verify` never see the row, and the corpus rewrite
  // then replaces the token with itself and reports no failures.
  const { parseMapRows } = await import("./transfer.ts");
  expect(() =>
    parseMapRows(
      JSON.stringify({
        oldPuuid: OLD_A,
        gameName: "N",
        tagLine: "T",
        newPuuid: OLD_A,
        status: "resolved",
      }),
    ),
  ).toThrow(/equal to the identifier it replaces/);
});

test("import refuses a replacement that contradicts one already held", async () => {
  // Two irreconcilable claims, and nothing here can tell which is right.
  // Overwriting would be invisible: the database holds a replacement rather than
  // the old value, so `apply` changes nothing and `verify` passes while the
  // archive gets translated to the wrong identity.
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status") VALUES (${db.param(1)}, ${db.param(2)}, 'resolved')`,
    [OLD_A, NEW_A],
  );
  const { importMap } = await import("./transfer.ts");
  await expect(
    importMap(db, [
      {
        oldPuuid: OLD_A,
        gameName: "N",
        tagLine: "T",
        newPuuid: NEW_B,
        status: "resolved",
      },
    ]),
  ).rejects.toThrow(/already maps to/);
  const rows = await db.query(`SELECT "newPuuid" AS n FROM "PuuidKeyMap"`);
  expect(rows[0]?.["n"]).toBe(NEW_A);
  await db.close();
});

test("import accepts a replacement identical to the one already held", async () => {
  // Re-importing the same map must stay a no-op; only disagreement is a fault.
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status") VALUES (${db.param(1)}, ${db.param(2)}, 'resolved')`,
    [OLD_A, NEW_A],
  );
  const { importMap } = await import("./transfer.ts");
  const result = await importMap(db, [
    {
      oldPuuid: OLD_A,
      gameName: "N",
      tagLine: "T",
      newPuuid: NEW_A,
      status: "resolved",
    },
  ]);
  expect(result).toEqual({ inserted: 0, updated: 1, downgraded: 0 });
  await db.close();
});

test("two rows disagreeing about one identity are refused", async () => {
  // From a hand edit or two exports concatenated. Without this the last row
  // silently wins: the check against the target compares each row to what the
  // DATABASE holds, so two rows that disagree with each other but not with it
  // both pass, and `apply` rewrites to whichever landed last.
  const { parseMapRows } = await import("./transfer.ts");
  expect(() => parseMapRows(`${mapLine(NEW_A)}\n${mapLine(NEW_B)}`)).toThrow(
    /contradicts an earlier line/,
  );
});

test("a duplicate row that agrees is collapsed, not refused", async () => {
  // Concatenating overlapping exports is ordinary; only disagreement is a fault.
  const { parseMapRows } = await import("./transfer.ts");
  expect(parseMapRows(`${mapLine(NEW_A)}\n${mapLine(NEW_A)}`)).toHaveLength(1);
});

test("two rows agreeing on no replacement but not on why are refused", async () => {
  // `stranded` is a recorded decision to give an identity up; `unresolved` is
  // work not finished. Collapsing them would let a stranded row smuggled in
  // ahead of an honest unresolved one bypass `--accept-stranded` — and `verify`
  // tolerates stranded, so the archive would stay old-domain with every gate
  // green.
  const { parseMapRows } = await import("./transfer.ts");
  expect(() =>
    parseMapRows(`${lostLine("stranded")}\n${lostLine("unresolved")}`),
  ).toThrow(/contradicts an earlier line/);
});

test("duplicate rows agreeing on both value and reason are collapsed", async () => {
  const { parseMapRows } = await import("./transfer.ts");
  expect(
    parseMapRows(`${lostLine("stranded")}\n${lostLine("stranded")}`),
  ).toHaveLength(1);
});

test("an imported stranding is downgraded, not honoured", async () => {
  // `stranded` is a decision, not a fact: an operator accepted losing an
  // identity forever, and `strand` demands a flag for it. A map file carrying
  // the status would make that decision on their behalf — `apply` allows a
  // stranded row and `verify` tolerates it, so the identity would be abandoned
  // with every gate green and nobody having chosen it.
  const db = await open();
  const { importMap } = await import("./transfer.ts");
  const result = await importMap(db, [
    {
      oldPuuid: OLD_A,
      gameName: null,
      tagLine: null,
      newPuuid: null,
      status: "stranded",
    },
  ]);
  expect(result.downgraded).toBe(1);
  const rows = await db.query(`SELECT "status" AS s FROM "PuuidKeyMap"`);
  expect(rows[0]?.["s"]).toBe("unresolved");
  await db.close();
});

test("a resolved mapping imports untouched", async () => {
  const db = await open();
  const { importMap } = await import("./transfer.ts");
  const result = await importMap(db, [
    {
      oldPuuid: OLD_A,
      gameName: "Zozio8z",
      tagLine: "EUW",
      newPuuid: NEW_A,
      status: "resolved",
    },
  ]);
  expect(result.downgraded).toBe(0);
  const rows = await db.query(`SELECT "status" AS s FROM "PuuidKeyMap"`);
  expect(rows[0]?.["s"]).toBe("resolved");
  await db.close();
});
