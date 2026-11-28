import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { PrismaClient } from "#generated/prisma/client.ts";
import { createFeedsPrismaClient } from "./sql.ts";
import { PostgresFeedsStore } from "./store.ts";
import { asyncFeedsRepository } from "@shepherdjerred/feeds/server/sqlite-repository.ts";
import { FEEDS_STORE_CONTRACT } from "@shepherdjerred/feeds/server/contract/contract.ts";
import { SAMPLE_CATALOG } from "@shepherdjerred/feeds/server/contract/support.ts";
import { FeedsStore } from "@shepherdjerred/feeds/server/store.ts";
import { createMigratedTestDatabase } from "./test-database.ts";
import type {
  FeedsRepository,
  ParsedFeedEntry,
} from "@shepherdjerred/feeds/server/types.ts";

let databaseUrl = "";
let dropDatabase: (() => Promise<void>) | undefined;
let admin: PrismaClient | undefined;

function requireAdmin(): PrismaClient {
  if (admin === undefined) {
    throw new Error("PostgreSQL test database was not initialized");
  }
  return admin;
}

/** An empty, freshly migrated store state, as a new deployment starts. */
async function resetDatabase(): Promise<void> {
  const db = requireAdmin();
  await db.$executeRawUnsafe(
    "TRUNCATE entries, feeds, categories, reader_sessions, meta RESTART IDENTITY CASCADE",
  );
  await db.meta.create({ data: { key: "subscriptions_etag", value: "1" } });
}

async function openPostgresStore(): Promise<FeedsRepository> {
  await resetDatabase();
  return await PostgresFeedsStore.connect(databaseUrl);
}

beforeAll(async () => {
  const database = await createMigratedTestDatabase();
  databaseUrl = database.databaseUrl;
  dropDatabase = database.drop;
  admin = createFeedsPrismaClient(databaseUrl);
});

afterAll(async () => {
  if (admin !== undefined) {
    await admin.$disconnect();
  }
  await dropDatabase?.();
});

describe("PostgreSQL FeedsStore contract", () => {
  for (const contractCase of FEEDS_STORE_CONTRACT) {
    test(contractCase.name, async () => {
      await contractCase.run(openPostgresStore);
    });
  }
});

/** Entries whose titles and authors exercise unicode61 tokenization. */
const SEARCH_CORPUS: readonly Pick<ParsedFeedEntry, "title" | "author">[] = [
  { title: "Shipping Vercel AI SDK in Production", author: "Jerred Shepherd" },
  { title: "Upgrading Hono to v1.4.2 safely", author: "Bjarne C++" },
  { title: "Notes on exact phrase matching in FTS5", author: "SQLite Team" },
  { title: "Café naïve résumé: Ångström Øresund Łódź", author: "Zoë" },
  { title: "İstanbul ẞtraße Straße ΟΔΟΣ ς", author: "Σωκράτης" },
  { title: "日本語のテキスト and ＦＵＬＬ width", author: "山田" },
  { title: "foo_bar baz-qux don’t a'b", author: "x́y" },
  { title: "Kernel sched_ext deep dive", author: "Eng" },
  { title: "Rust 2024 edition: async closures", author: "Rust Team" },
  { title: "Postgres 18 release notes", author: "PGDG" },
  { title: "ด้วย Thai हिन्दी emoji 🚀", author: "" },
  { title: "Phrase across fields ends here", author: "here begins author" },
];

const SEARCH_QUERIES: readonly string[] = [
  "AI SDK",
  "ai",
  "sdk",
  "v1.4.2",
  "c++",
  '"exact phrase"',
  '"exact',
  "+++ ???",
  "resume",
  "résumé",
  "RÉSUMÉ",
  "angstrom",
  "lodz",
  "istanbul",
  "strasse",
  "straße",
  "οδοσ",
  "σωκ",
  "日本",
  "日本語のテキスト",
  "ｆｕｌｌ",
  "full",
  "foo_bar",
  "foo",
  '"foo bar"',
  '"baz qux"',
  "don",
  "xy",
  "sched_ext",
  '"sched ext deep"',
  "2024",
  "18",
  '"here here"',
  '"ends here"',
  "here begins",
  "emoji",
  "ด",
  "_",
  '""',
  "Jerred Shepherd",
  "shep",
  "team",
  "q",
];

async function seedSearchCorpus(store: FeedsRepository): Promise<void> {
  await store.reconcileCatalog(SAMPLE_CATALOG);
  const blog = await store.getFeedByUrl("https://sjer.red/rss.xml");
  if (blog === undefined) {
    throw new Error("Expected the blog feed");
  }
  await store.recordPollSuccess({
    feedId: blog.id,
    polledAtSeconds: 1_720_000_000,
    etag: null,
    lastModified: null,
    entries: SEARCH_CORPUS.map((entry, index) => ({
      ...entry,
      guid: `search-${String(index)}`,
      url: `https://sjer.red/search/${String(index)}`,
      contentHtml: "",
      publishedAt: 1_720_000_000 + index,
      enclosures: [],
    })),
  });
}

describe("PostgreSQL search parity with SQLite FTS5", () => {
  test("every query returns the same entries on both stores", async () => {
    const sqlite = asyncFeedsRepository(FeedsStore.open(":memory:"));
    const postgres = await openPostgresStore();
    try {
      await seedSearchCorpus(sqlite);
      await seedSearchCorpus(postgres);
      let matchingQueries = 0;
      for (const q of SEARCH_QUERIES) {
        const [expected, actual] = await Promise.all([
          sqlite.queryEntries({ view: "all", q, limit: 500 }),
          postgres.queryEntries({ view: "all", q, limit: 500 }),
        ]);
        expect({ q, ...actual }).toEqual({ q, ...expected });
        matchingQueries += actual.totalMatching > 0 ? 1 : 0;
      }
      expect(matchingQueries).toBeGreaterThan(30);
      expect(
        await postgres.queryEntries({ view: "all", q: '"ends here"' }),
      ).toMatchObject({ totalMatching: 1 });
      expect(
        await postgres.queryEntries({ view: "all", q: '"here here"' }),
      ).toMatchObject({ totalMatching: 0 });
    } finally {
      await Promise.all([sqlite.close(), postgres.close()]);
    }
  });
});
