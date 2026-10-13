import { expect, it, vi } from "vitest";
import { z } from "zod";
import { Importer } from "#infrastructure/importer.ts";
import { PrismaUnitOfWork } from "#infrastructure/prisma-unit-of-work.ts";
import { Issues } from "#infrastructure/issues.ts";
import { CreateIssueSchema } from "#shared/schema.ts";
import { cloneTestDatabase } from "./postgres.ts";
import { memoryObjectStore } from "./memory-object-store.ts";
import { importFixture, migrationActor } from "./import-fixture.ts";

async function fixture() {
  const suite = await cloneTestDatabase(
    z.url().parse(Bun.env["TRACKER_TEST_ADMIN_URL"]),
  );
  const store = memoryObjectStore();
  const importer = new Importer(suite.database, store);
  const records = importFixture();
  return { ...suite, importer, records, store };
}

it("imports complete history, original authors/timestamps, labels, relations, files and counters", async () => {
  const test = await fixture();
  try {
    for (const record of test.records)
      await test.importer.apply(record, crypto.randomUUID());
    const issues = new Issues(
      test.database,
      new PrismaUnitOfWork(test.database),
    );
    const issue = await issues.byIdentifier("AI-150");
    expect(issue.creator.key).toBe("human:linear-owner");
    expect(issue.archivedAt?.toISOString()).toBe("2025-01-02T03:04:05.000Z");
    expect(issue.labels.map((label) => label.name)).toEqual(["Imported label"]);
    expect(issue.comments[0]?.body).toBe("Original comment");
    expect(issue.relations).toHaveLength(1);
    expect(issue.voteCount).toBe(1);
    const attachment = issue.attachments[0];
    if (attachment === undefined)
      throw new Error("Imported attachment is missing");
    expect(
      await new Response(test.store.get(attachment.storageKey)).text(),
    ).toBe("Historical file bytes");
    const event = await test.database.event.findUniqueOrThrow({
      where: { sourceIdentity: "linear:history-1" },
    });
    expect(event.before).toEqual({ description: "First description" });
    expect(event.rawSourcePayload).toEqual({
      id: "history-1",
      unsupportedCycle: "preserved",
    });
    const next = await issues.create(
      CreateIssueSchema.parse({
        actor: migrationActor,
        teamKey: "AI",
        title: "After cutover",
      }),
      "next",
    );
    expect(next.identifier).toBe("AI-151");
  } finally {
    await test.close();
  }
});

it("performs zero database or S3 writes when a completed export is rerun", async () => {
  const test = await fixture();
  try {
    for (const record of test.records)
      await test.importer.apply(record, crypto.randomUUID());
    const put = vi.spyOn(test.store, "put");
    const remove = vi.spyOn(test.store, "delete");
    await test.database
      .$executeRaw`CREATE FUNCTION deny_import_rerun_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Rerun attempted a write to %', TG_TABLE_NAME; END $$`;
    await test.database
      .$executeRaw`DO $$ DECLARE tab record; BEGIN FOR tab IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP EXECUTE format('CREATE TRIGGER deny_write BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION deny_import_rerun_write()', tab.tablename); END LOOP; END $$`;
    for (const record of test.records) {
      const result = await test.importer.apply(
        {
          ...record,
          actor: {
            ...migrationActor,
            metadata: { sessionId: "a-new-import-session" },
          },
        },
        "rerun",
      );
      expect(result.status).toBe("unchanged");
    }
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  } finally {
    await test.close();
  }
});

it("resumes an interrupted export and rejects changed source data without writes", async () => {
  const test = await fixture();
  try {
    for (const record of test.records.slice(0, 6))
      await test.importer.apply(record, "interrupted");
    for (const record of test.records)
      await test.importer.apply(record, "resume");
    expect(await test.database.importMapping.count()).toBe(test.records.length);
    const issue = test.records.find((record) => record.entityType === "issue");
    if (issue?.entityType !== "issue") throw new Error("Missing issue fixture");
    const before = await test.database.actor.findUniqueOrThrow({
      where: { key: migrationActor.key },
    });
    await expect(
      test.importer.apply(
        { ...issue, data: { ...issue.data, title: "Changed export" } },
        "changed",
      ),
    ).rejects.toThrow("Import content changed");
    const after = await test.database.actor.findUniqueOrThrow({
      where: { key: migrationActor.key },
    });
    expect(after.seenCount).toBe(before.seenCount);
    const file = test.records.find(
      (record) => record.entityType === "attachment",
    );
    if (file?.entityType !== "attachment")
      throw new Error("Missing attachment fixture");
    await expect(
      test.importer.apply(
        {
          ...file,
          externalId: "corrupt-file",
          data: { ...file.data, contentBase64: "YnJva2Vu" },
        },
        "corrupt",
      ),
    ).rejects.toThrow("checksum mismatch");
    expect(await test.database.importMapping.count()).toBe(test.records.length);
  } finally {
    await test.close();
  }
});
