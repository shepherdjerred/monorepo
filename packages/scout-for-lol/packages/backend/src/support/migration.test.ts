import { afterAll, expect, test } from "vitest";
import { z } from "zod";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";

const database = createTestDatabase("support-migration");
afterAll(async () => {
  await dropTestDatabase(database.prisma, database.dbPath);
});

test("historical feedback and failed replies survive without notification jobs", async () => {
  const inbox = await Bun.file(
    new URL(
      "../../prisma/migrations/20261003000000_support_inbox/migration.sql",
      import.meta.url,
    ),
  ).text();
  const conversations = await Bun.file(
    new URL(
      "../../prisma/migrations/20261003010000_support_conversations/migration.sql",
      import.meta.url,
    ),
  ).text();
  const senderThrottle = await Bun.file(
    new URL(
      "../../prisma/migrations/20261004000000_support_sender_throttle/migration.sql",
      import.meta.url,
    ),
  ).text();
  // psql executes the exact multi-statement migration, in an isolated schema
  // of the isolated test DB, not a hand-translated set of Prisma statements.
  const script = `CREATE SCHEMA support_migration_fixture;
    SET search_path TO support_migration_fixture;
    CREATE TABLE "Feedback" (id SERIAL PRIMARY KEY, "discordId" TEXT NOT NULL, body TEXT NOT NULL, rating INTEGER, "serverId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO "Feedback" ("discordId", body, "createdAt") VALUES ('100000000000000001', 'Old web feedback', '2026-09-01');
    ${inbox}
    INSERT INTO "Feedback" ("discordId", body, source, "readAt", "createdAt", "discordUsername") VALUES ('100000000000000001', 'Old bot DM', 'DISCORD_DM', '2026-09-03', '2026-09-02', 'fixture');
    INSERT INTO "FeedbackReply" (id, "feedbackId", "operatorDiscordId", body, status, "createdAt") VALUES ('old-reply', 2, '160509172704739328', 'Old human answer', 'DM_DISABLED', '2026-09-04');
    ${conversations}
    ${senderThrottle}
    INSERT INTO "Feedback" ("discordId", body, source, "createdAt", "discordUsername") VALUES ('100000000000000001', 'Late old-pod DM', 'DISCORD_DM', '2026-09-05', 'fixture');
    SELECT json_build_object(
      'messages', (SELECT json_agg(t) FROM (SELECT body, direction, "readAt", "conversationId" FROM "Feedback" ORDER BY "createdAt", id) t),
      'replies', (SELECT json_agg(t) FROM (SELECT fr.status, f.direction FROM "FeedbackReply" fr JOIN "Feedback" f ON f.id = fr."feedbackId") t),
      'jobs', (SELECT count(*) FROM "SupportJob"),
      'conversation', (SELECT row_to_json(t) FROM (SELECT "lastMessageAt", "operatorReadAt" FROM "SupportConversation") t));`;
  const process = Bun.spawn(
    ["psql", database.dbUrl, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  await process.stdin.write(script);
  await process.stdin.end();
  const [output, errors, status] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  expect(status, errors).toBe(0);
  const result = z
    .object({
      messages: z.array(
        z.object({
          body: z.string(),
          direction: z.string(),
          readAt: z.string().nullable(),
          conversationId: z.string(),
        }),
      ),
      replies: z.array(z.object({ status: z.string(), direction: z.string() })),
      jobs: z.number(),
      conversation: z.object({
        lastMessageAt: z.string(),
        operatorReadAt: z.string().nullable(),
      }),
    })
    .parse(JSON.parse(output));
  expect(result.messages.map((row) => row.body)).toEqual([
    "Old web feedback",
    "Old bot DM",
    "Old human answer",
    "Late old-pod DM",
  ]);
  expect(result.messages.map((row) => row.direction)).toEqual([
    "INBOUND",
    "INBOUND",
    "OUTBOUND",
    "INBOUND",
  ]);
  expect(new Set(result.messages.map((row) => row.conversationId)).size).toBe(
    1,
  );
  expect(result.messages[1]?.readAt).not.toBeNull();
  expect(result.replies).toEqual([
    { status: "DM_DISABLED", direction: "OUTBOUND" },
  ]);
  expect(result.jobs).toBe(0);
  expect(result.conversation.lastMessageAt).toBe("2026-09-05T00:00:00");
  expect(result.conversation.operatorReadAt).toBeNull();
});
