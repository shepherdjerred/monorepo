import { PrismaClient } from "@prisma/client";

const dbArg = Bun.argv.find((arg) => arg.startsWith("--db="));
const dbUrl = dbArg == null ? "file:./data/sentinel.db" : dbArg.slice("--db=".length);

const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } },
});

try {
  console.log(`Connecting to database: ${dbUrl}\n`);

  const statusCounts = await prisma.$queryRawUnsafe<{ status: string; count: bigint }[]>(
    "SELECT status, COUNT(*) as count FROM Job GROUP BY status",
  );

  console.log("=== Queue Status ===");
  if (statusCounts.length === 0) {
    console.log("No jobs found.");
  } else {
    for (const row of statusCounts) {
      console.log(`  ${row.status}: ${String(row.count)}`);
    }
  }

  console.log("\n=== Recent Jobs (last 10) ===");
  const recentJobs = await prisma.$queryRawUnsafe<
    {
      id: string;
      agent: string;
      status: string;
      triggerType: string;
      triggerSource: string;
      createdAt: string;
    }[]
  >("SELECT id, agent, status, triggerType, triggerSource, createdAt FROM Job ORDER BY createdAt DESC LIMIT 10");

  if (recentJobs.length === 0) {
    console.log("No jobs found.");
  } else {
    console.table(recentJobs);
  }
} catch (error: unknown) {
  console.error("Failed to query database:", error);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
