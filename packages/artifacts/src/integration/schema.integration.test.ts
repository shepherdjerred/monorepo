import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  createEmptyTestDatabase,
  ensureSharedPostgres,
  envWithPostgresBin,
  runCommandAsync,
  type OwnedTestDatabaseHandle,
} from "@shepherdjerred/test-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "#generated/prisma/client.ts";

const packageRoot = path.resolve(import.meta.dir, "../..");
const SHA = "a".repeat(64);

let dbHandle: OwnedTestDatabaseHandle | undefined;
let databaseUrl = "";
let prisma: PrismaClient;

beforeAll(async () => {
  const shared = ensureSharedPostgres();
  dbHandle = await createEmptyTestDatabase({
    prefix: "tracker",
    kind: "test",
    adminUrl: shared.superUrl,
  });
  databaseUrl = dbHandle.url;

  const migrate = await runCommandAsync(["bun", "run", "migrate:deploy"], {
    cwd: packageRoot,
    env: envWithPostgresBin({ DATABASE_URL: databaseUrl }),
  });
  if (migrate.exitCode !== 0) {
    throw new Error(
      `artifacts prisma migrate deploy failed: ${migrate.stderr || migrate.stdout}`,
    );
  }
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await dbHandle?.drop();
});

async function seedActor() {
  return prisma.actor.create({
    data: {
      key: `agent:${crypto.randomUUID()}`,
      kind: "agent",
      name: "test",
      metadata: {},
    },
  });
}

/** An actor, a board, an artifact and an upload session: the parents of a Version. */
async function seedVersionParents() {
  const actor = await seedActor();
  const board = await prisma.board.create({
    data: { slug: `b-${crypto.randomUUID()}`, title: "Board", index: {} },
  });
  const artifact = await prisma.artifact.create({
    data: {
      boardId: board.id,
      title: "A",
      kind: "html",
      ownerKey: "host:/work",
    },
  });
  const upload = await prisma.uploadSession.create({
    data: {
      idempotencyKey: crypto.randomUUID(),
      requestDigest: SHA,
      boardId: board.id,
      artifactId: artifact.id,
      request: {},
      createdById: actor.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return { actor, board, artifact, upload };
}

async function constraintViolation(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the database to reject the row");
}

describe("artifacts migration", () => {
  it("notifies artifacts_events with ids only when an Event row commits", async () => {
    const actor = await seedActor();
    const listener = new pg.Client({ connectionString: databaseUrl });
    await listener.connect();
    try {
      const received = new Promise<pg.Notification>((resolve) => {
        listener.on("notification", resolve);
      });
      await listener.query("LISTEN artifacts_events");
      const event = await prisma.event.create({
        data: {
          boardId: "6c1f4f7e-0000-4000-8000-000000000001",
          kind: "comment.created",
          entityId: crypto.randomUUID(),
          actorId: actor.id,
          requestId: crypto.randomUUID(),
          payload: { contentToken: "must-not-leak", body: "private" },
        },
      });
      const notification = await received;
      expect(notification.channel).toBe("artifacts_events");
      const payload: unknown = JSON.parse(notification.payload ?? "null");
      expect(payload).toEqual({
        seq: Number(event.seq),
        boardId: "6c1f4f7e-0000-4000-8000-000000000001",
        kind: "comment.created",
      });
    } finally {
      await listener.end();
    }
  });

  it("does not notify for an Event row that rolls back", async () => {
    const actor = await seedActor();
    const listener = new pg.Client({ connectionString: databaseUrl });
    await listener.connect();
    try {
      const seen: pg.Notification[] = [];
      listener.on("notification", (message) => seen.push(message));
      await listener.query("LISTEN artifacts_events");
      const rollback = new Error("rollback");
      await prisma
        .$transaction(async (transaction) => {
          await transaction.event.create({
            data: {
              kind: "board.updated",
              entityId: crypto.randomUUID(),
              actorId: actor.id,
              requestId: crypto.randomUUID(),
              payload: {},
            },
          });
          throw rollback;
        })
        .catch((error: unknown) => {
          if (error !== rollback) throw error;
        });
      await listener.query("SELECT 1");
      expect(seen).toEqual([]);
    } finally {
      await listener.end();
    }
  });

  it("rejects a Blob whose sha256 is not 64 lowercase hex characters", async () => {
    for (const sha256 of [
      "A".repeat(64),
      "a".repeat(63),
      `${"a".repeat(63)}g`,
    ]) {
      const message = await constraintViolation(
        prisma.blob.create({
          data: { sha256, storageKey: crypto.randomUUID(), size: 1n },
        }),
      );
      expect(message).toContain("Blob_sha256_check");
    }
    const blob = await prisma.blob.create({
      data: { sha256: SHA, storageKey: crypto.randomUUID(), size: 1n },
    });
    expect(blob.sha256).toBe(SHA);
  });

  it("rejects an UploadFile and a poster digest that are not lowercase hex", async () => {
    const { actor, artifact, upload } = await seedVersionParents();
    expect(
      await constraintViolation(
        prisma.uploadFile.create({
          data: {
            uploadId: upload.id,
            path: "index.html",
            sha256: "Z".repeat(64),
            size: 1n,
            mediaType: "text/html",
          },
        }),
      ),
    ).toContain("UploadFile_sha256_check");
    expect(
      await constraintViolation(
        prisma.version.create({
          data: {
            artifactId: artifact.id,
            number: 1,
            contentToken: crypto.randomUUID(),
            entryPath: "index.html",
            totalBytes: 1n,
            posterSha256: "nope",
            publisherId: actor.id,
            uploadId: upload.id,
          },
        }),
      ),
    ).toContain("Version_posterSha256_check");
  });

  it("rejects a Board revision below 1", async () => {
    for (const revision of [0, -1]) {
      const message = await constraintViolation(
        prisma.board.create({
          data: {
            slug: `b-${crypto.randomUUID()}`,
            title: "Board",
            index: {},
            revision,
          },
        }),
      );
      expect(message).toContain("Board_revision_check");
    }
  });

  it("restricts deleting a Blob that a VersionFile references", async () => {
    const { actor, artifact, upload } = await seedVersionParents();
    const sha256 = "c".repeat(64);
    await prisma.blob.create({
      data: { sha256, storageKey: crypto.randomUUID(), size: 3n },
    });
    const version = await prisma.version.create({
      data: {
        artifactId: artifact.id,
        number: 1,
        contentToken: crypto.randomUUID(),
        entryPath: "index.html",
        totalBytes: 3n,
        publisherId: actor.id,
        uploadId: upload.id,
      },
    });
    await prisma.versionFile.create({
      data: {
        versionId: version.id,
        path: "index.html",
        sha256,
        mediaType: "text/html",
      },
    });
    const message = await constraintViolation(
      prisma.blob.delete({ where: { sha256 } }),
    );
    expect(message.toLowerCase()).toContain("foreign key");
    expect(
      await constraintViolation(
        prisma.versionFile.create({
          data: {
            versionId: version.id,
            path: "missing.js",
            sha256: "d".repeat(64),
            mediaType: "text/javascript",
          },
        }),
      ),
    ).toBeTruthy();
  });

  it("indexes only unhandled deliveries", async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'Delivery' AND indexname = 'Delivery_unhandled_idx'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain('WHERE ("handledAt" IS NULL)');
  });
});
