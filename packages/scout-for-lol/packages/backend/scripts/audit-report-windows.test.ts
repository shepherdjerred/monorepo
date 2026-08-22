import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { parseAndCompile } from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

const { prisma, dbPath } = createTestDatabase("audit-report-windows-test");
const backendRoot = `${import.meta.dir}/..`;

beforeEach(async () => {
  await prisma.report.deleteMany();
});

afterAll(async () => {
  await prisma.report.deleteMany();
  await prisma.$disconnect();
});

async function createReport(queryText: string): Promise<number> {
  const now = new Date();
  const report = await prisma.report.create({
    data: {
      serverId: testGuildId("701"),
      ownerId: testAccountId("702"),
      channelId: testChannelId("703"),
      title: "Audit fixture",
      queryText,
      cronExpression: "0 0 * * *",
      scheduleTimezone: "UTC",
      createdTime: now,
      updatedTime: now,
    },
  });
  return report.id;
}

async function runAudit(fix: boolean): Promise<{
  exitCode: number;
  output: string;
}> {
  const child = Bun.spawn({
    cmd: [
      "bun",
      "scripts/audit-report-windows.ts",
      "--database",
      dbPath,
      ...(fix ? ["--fix"] : []),
    ],
    cwd: backendRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: `${stdout}\n${stderr}` };
}

describe("audit-report-windows", () => {
  test("fixes arbitrary whitespace without splicing inside quoted keywords", async () => {
    const id = await createReport(
      "SELECT games FROM match_participants WHERE player = 'group by' GROUP  \n BY all",
    );

    const result = await runAudit(true);

    expect(result.exitCode).toBe(0);
    const report = await prisma.report.findUniqueOrThrow({ where: { id } });
    expect(report.queryText).toContain("player = 'group by'");
    expect(report.queryText).toContain(
      "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'",
    );
    expect(() => parseAndCompile(report.queryText)).not.toThrow();
  });

  test("preserves compact legacy lookback predicates", async () => {
    const queryText =
      "SELECT games FROM match_participants WHERE game_creation_at>=CURRENT_TIMESTAMP-INTERVAL '14 days' GROUP BY all";
    const id = await createReport(queryText);

    const result = await runAudit(true);

    expect(result.exitCode).toBe(0);
    const report = await prisma.report.findUniqueOrThrow({ where: { id } });
    expect(report.queryText).toBe(queryText);
    expect(parseAndCompile(report.queryText).window).toEqual({
      kind: "relative",
      days: 14,
    });
  });

  test("fails even in fix mode when a stated period does not compile", async () => {
    await createReport(
      "SELECT games FROM match_participants GROUP BY all DURING LAST FORTNIGHT",
    );

    const result = await runAudit(true);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Invalid DURING clause");
  });
});
