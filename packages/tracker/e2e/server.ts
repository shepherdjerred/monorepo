import { startTestPostgres, cloneTestDatabase } from "#testing/postgres.ts";
import { memoryObjectStore } from "#testing/memory-object-store.ts";
import { PrismaUnitOfWork } from "#infrastructure/prisma-unit-of-work.ts";
import { Issues } from "#infrastructure/issues.ts";
import { Collaboration } from "#infrastructure/collaboration.ts";
import { Catalog } from "#infrastructure/catalog.ts";
import { Attachments } from "#infrastructure/attachments.ts";
import { createApp } from "#server/app.ts";
import { ActorSchema } from "#shared/actor.ts";
import { CreateIssueSchema } from "#shared/schema.ts";

const cluster = await startTestPostgres();
const suite = await cloneTestDatabase(cluster.adminUrl);
const unit = new PrismaUnitOfWork(suite.database);
const issues = new Issues(suite.database, unit);
const catalog = new Catalog(unit);
const actor = ActorSchema.parse({
  key: "human:jerred",
  kind: "human",
  name: "Jerred",
  metadata: { harness: "browser" },
});
await catalog.label(
  { actor, teamKey: "AI", name: "feature", color: "#8b5cf6" },
  "create",
  "seed",
);
await catalog.label(
  { actor, teamKey: "AI", name: "bug", color: "#e46169" },
  "create",
  "seed",
);
const samples = [
  ["Polish the issue creation flow", "started", "toolkit", 2, "feature"],
  ["Make attachment uploads resumable", "unstarted", "homelab", 3, "feature"],
  [
    "Investigate worker restart during reconciliation",
    "triage",
    "homelab",
    1,
    "bug",
  ],
  [
    "Capture the board's keyboard interaction",
    "backlog",
    "developer-experience",
    4,
    "feature",
  ],
  [
    "Add confidence intervals to match reports",
    "unstarted",
    "scout",
    3,
    "feature",
  ],
  [
    "Restore a snapshot into an isolated namespace",
    "started",
    "homelab",
    2,
    "feature",
  ],
  [
    "Keep session identity stable after resuming",
    "completed",
    "toolkit",
    2,
    "bug",
  ],
] as const;
for (const [title, stateType, projectSlug, priority, label] of samples) {
  await issues.create(
    CreateIssueSchema.parse({
      actor,
      teamKey: "AI",
      title,
      stateType,
      projectSlug,
      priority,
      labels: [label],
      description:
        "A focused improvement to keep everyday work predictable.\n\n## Acceptance\n\n- [ ] Verify the behavior with a realistic example\n- [ ] Keep the result visible in the audit history\n\nRelated work: AI-2",
    }),
    "seed",
  );
}
const app = createApp({
  issues,
  catalog,
  collaboration: new Collaboration(suite.database, unit),
  attachments: new Attachments(suite.database, unit, memoryObjectStore()),
  writesEnabled: () => Promise.resolve(true),
  attachmentMaxBytes: () => Promise.resolve(25 * 1024 * 1024),
});
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 17_351,
  fetch: app.fetch,
});
console.warn(`Tracker acceptance server on ${String(server.port)}`);
async function shutdown() {
  await server.stop(true);
  await suite.close();
  await cluster.stop();
}
process.once("SIGTERM", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown();
});
