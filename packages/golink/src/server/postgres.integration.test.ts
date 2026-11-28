import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  currentDatabaseOwner,
  databaseUrlFromAdmin,
  ensureSharedPostgres,
  envWithPostgresBin,
  ownerCommentSql,
  psqlMaintenanceCommandsAsync,
  runCommandAsync,
} from "@shepherdjerred/test-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "#generated/prisma/client.ts";
import { createPrismaManualLinkRepository } from "#infrastructure/db.ts";
import {
  LinkItemSchema,
  LinksDirectoryResponseSchema,
} from "#shared/contract.ts";
import { createGolinkServer } from "./app.ts";

const packageRoot = path.resolve(import.meta.dir, "../..");
const dbSuffix = crypto.randomUUID().replaceAll("-", "");
const dbName = `tracker_test_golink_${dbSuffix}`;

let superUrl = "";
let databaseUrl = "";
let prisma: PrismaClient | undefined;

beforeAll(async () => {
  const shared = ensureSharedPostgres();
  superUrl = shared.superUrl;
  databaseUrl = databaseUrlFromAdmin(superUrl, dbName);

  await psqlMaintenanceCommandsAsync(
    [
      `CREATE DATABASE "${dbName}"`,
      ownerCommentSql(dbName, currentDatabaseOwner()),
    ],
    { adminUrl: superUrl },
  );

  const migrate = await runCommandAsync(["bun", "run", "migrate:deploy"], {
    cwd: packageRoot,
    env: envWithPostgresBin({ DATABASE_URL: databaseUrl }),
  });
  if (migrate.exitCode !== 0) {
    const detail = migrate.stderr.length > 0 ? migrate.stderr : migrate.stdout;
    throw new Error(`golink prisma migrate deploy failed: ${detail}`);
  }

  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
});

afterAll(async () => {
  if (prisma !== undefined) {
    await prisma.$disconnect();
  }
  if (superUrl !== "") {
    await psqlMaintenanceCommandsAsync(
      [`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`],
      { adminUrl: superUrl },
    );
  }
});

describe("golink PostgreSQL integration", () => {
  it("seeds idempotently with ON CONFLICT DO NOTHING, persists CRUD, and records redirect clicks", async () => {
    if (prisma === undefined) {
      throw new Error("Prisma client was not initialized");
    }
    const repo = createPrismaManualLinkRepository(prisma);

    const firstSeedCount = await repo.seedIfMissing([
      {
        short: "ha",
        targetUrl: "https://homeassistant.tailnet-1a49.ts.net/",
        createdBy: "seed",
      },
      {
        short: "router",
        targetUrl: "https://192.168.1.1/",
        createdBy: "seed",
      },
    ]);
    expect(firstSeedCount).toBe(2);

    // Re-seeding with a different URL for an existing slug must NOT overwrite it
    const secondSeedCount = await repo.seedIfMissing([
      {
        short: "ha",
        targetUrl: "https://should-not-overwrite.example.com/",
        createdBy: "seed-2",
      },
      {
        short: "nas",
        targetUrl: "https://nas.tailnet-1a49.ts.net/",
        createdBy: "seed-2",
      },
    ]);
    expect(secondSeedCount).toBe(1);

    const haAfterReseed = await repo.findByShort("ha");
    expect(haAfterReseed?.targetUrl).toBe(
      "https://homeassistant.tailnet-1a49.ts.net/",
    );
    expect(haAfterReseed?.createdBy).toBe("seed");

    const { app } = createGolinkServer({
      repo,
      getIngressHosts: () => ["grafana.tailnet-1a49.ts.net"],
      platformSites: [],
      tailnetDomain: "tailnet-1a49.ts.net",
      dynamicAliasesEnabled: () => Promise.resolve(true),
      writesEnabled: () => Promise.resolve(true),
    });

    const ready = await app.request("http://go.local/readyz");
    expect(ready.status).toBe(200);
    expect(await ready.text()).toBe("ready");

    const upsertRes = await app.request(
      "http://go.local/api/links",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Tailscale-User-Login": "jerred@sjer.red",
        },
        body: JSON.stringify({
          short: "docs",
          targetUrl: "https://wiki.sjer.red/architecture",
        }),
      },
      // Through the Tailscale sidecar, so the login is trusted.
      { peerAddress: "127.0.0.1" },
    );
    expect(upsertRes.status).toBe(200);
    const created = LinkItemSchema.parse(await upsertRes.json());
    expect(created.short).toBe("docs");
    expect(created.clicks).toBe(0);
    expect(created.createdBy).toBe("jerred@sjer.red");

    const redirectRes = await app.request("http://go.local/docs/golink");
    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.get("Location")).toBe(
      "https://wiki.sjer.red/architecture/golink",
    );

    // Wait briefly for fire-and-forget click increment to commit
    let attempts = 0;
    while (attempts < 20) {
      attempts += 1;
      const row = await repo.findByShort("docs");
      if ((row?.clicks ?? 0) >= 1) {
        break;
      }
      await Bun.sleep(25);
    }

    const directoryRes = await app.request("http://go.local/api/links");
    expect(directoryRes.status).toBe(200);
    const directory = LinksDirectoryResponseSchema.parse(
      await directoryRes.json(),
    );
    const docsEntry = directory.links.find((item) => item.short === "docs");
    expect(docsEntry?.clicks).toBe(1);
    expect(docsEntry?.lastClickedAt).not.toBeNull();

    const deleteRes = await app.request("http://go.local/api/links/router", {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);
    expect(await repo.findByShort("router")).toBeNull();
  });
});
