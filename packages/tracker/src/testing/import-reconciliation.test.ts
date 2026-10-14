import { expect, it } from "vitest";
import { z } from "zod";
import { Importer } from "#infrastructure/importer.ts";
import { cloneTestDatabase } from "./postgres.ts";
import { memoryObjectStore } from "./memory-object-store.ts";
import { importFixture } from "./import-fixture.ts";

it("reconciles source edits, preserves history, and reruns without writes", async () => {
  const suite = await cloneTestDatabase(
    z.url().parse(Bun.env["TRACKER_TEST_ADMIN_URL"]),
  );
  try {
    const importer = new Importer(suite.database, memoryObjectStore());
    const records = importFixture();
    const previous = records.find((record) => record.entityType === "issue");
    if (previous?.entityType !== "issue")
      throw new Error("Missing fixture issue");
    previous.rawSourcePayload["updatedAt"] = previous.data.updatedAt;
    for (const record of records)
      await importer.apply(record, crypto.randomUUID());
    const timestamp = "2025-02-03T04:05:06.000Z";
    const next = {
      ...previous,
      data: {
        ...previous.data,
        updatedAt: timestamp,
        description: "Edited in Linear during export",
      },
      rawSourcePayload: {
        ...previous.rawSourcePayload,
        updatedAt: timestamp,
        description: "Edited in Linear during export",
      },
    };
    const beforeEvents = await suite.database.event.count();
    expect(
      await importer.reconcile({ previous, next }, "catch-up"),
    ).toMatchObject({ status: "reconciled" });
    const saved = await suite.database.issue.findUniqueOrThrow({
      where: { externalRef: "linear:" + previous.externalId },
    });
    expect(saved.updatedAt.toISOString()).toBe(timestamp);
    expect(saved.createdAt.toISOString()).toBe(previous.data.createdAt);
    expect(saved.title).toBe(previous.data.title);
    expect(saved.description).toBe(next.data.description);
    expect(saved.voteCount).toBe(1);
    const originalEvent = await suite.database.event.findFirstOrThrow({
      where: { entityType: "issue", entityId: saved.id, action: "imported" },
    });
    expect(originalEvent.rawSourcePayload).toEqual(previous.rawSourcePayload);
    expect(await suite.database.event.count()).toBe(beforeEvents + 1);
    const actors = await suite.database.actor.findMany({
      orderBy: { id: "asc" },
    });
    expect(await importer.reconcile({ previous, next }, "retry")).toMatchObject(
      { status: "unchanged" },
    );
    expect(await suite.database.event.count()).toBe(beforeEvents + 1);
    expect(
      await suite.database.actor.findMany({ orderBy: { id: "asc" } }),
    ).toEqual(actors);
    expect(await importer.apply(next, "new-snapshot")).toMatchObject({
      status: "unchanged",
    });
    await expect(
      importer.reconcile(
        {
          previous,
          next: { ...next, data: { ...next.data, identifier: "AI-149" } },
        },
        "reject",
      ),
    ).rejects.toThrow("identity");
    await expect(
      importer.reconcile(
        {
          previous: {
            ...previous,
            rawSourcePayload: { updatedAt: previous.data.updatedAt },
          },
          next: {
            ...next,
            rawSourcePayload: { updatedAt: next.data.updatedAt },
          },
        },
        "stale",
      ),
    ).rejects.toThrow("Previous snapshot");
    await suite.database.issue.update({
      where: { id: saved.id },
      data: { revision: { increment: 1 } },
    });
    const later = {
      ...next,
      data: { ...next.data, updatedAt: "2025-03-01T00:00:00.000Z" },
      rawSourcePayload: {
        ...next.rawSourcePayload,
        updatedAt: "2025-03-01T00:00:00.000Z",
      },
    };
    await expect(
      importer.reconcile({ previous: next, next: later }, "native-edit"),
    ).rejects.toThrow("outside migration");
  } finally {
    await suite.close();
  }
});

it("imports a source comment edit and rejects changed destination content", async () => {
  const suite = await cloneTestDatabase(
    z.url().parse(Bun.env["TRACKER_TEST_ADMIN_URL"]),
  );
  try {
    const importer = new Importer(suite.database, memoryObjectStore());
    const records = importFixture();
    for (const record of records)
      await importer.apply(record, crypto.randomUUID());
    const previous = records.find((record) => record.entityType === "comment");
    if (previous?.entityType !== "comment")
      throw new Error("Missing fixture comment");
    const next = {
      ...previous,
      data: {
        ...previous.data,
        body: "Edited in Linear",
        editedAt: "2025-02-01T00:00:00.000Z",
      },
      rawSourcePayload: {
        ...previous.rawSourcePayload,
        body: "Edited in Linear",
      },
    };
    const result = await importer.reconcile({ previous, next }, "comment-edit");
    expect(result.status).toBe("reconciled");
    expect(
      await importer.reconcile({ previous, next }, "comment-retry"),
    ).toMatchObject({ status: "unchanged" });
    await suite.database.comment.update({
      where: { id: result.destinationId },
      data: { body: "Native edit" },
    });
    const events = await suite.database.event.count();
    await expect(
      importer.reconcile(
        {
          previous: next,
          next: { ...next, data: { ...next.data, body: "Later source edit" } },
        },
        "conflict",
      ),
    ).rejects.toThrow("outside migration");
    expect(await suite.database.event.count()).toBe(events);
  } finally {
    await suite.close();
  }
});
