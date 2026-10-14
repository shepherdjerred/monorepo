import { expect, test } from "vitest";
import { planCatchUp } from "#lib/tracker/migration/catch-up.ts";
import { planMigration } from "#lib/tracker/migration/normalize.ts";
import { migrationActor, migrationFixture } from "./migration-fixture.ts";

test("catch-up plans new history and timestamp changes while preserving original events", async () => {
  const before = migrationFixture();
  const after = structuredClone(before);
  after.exportedAt = "2026-02-01T00:00:00.000Z";
  const issue = after.issues[0];
  if (issue === undefined) throw new Error("Missing fixture issue");
  issue.updatedAt = "2026-01-03T00:00:00.000Z";
  const comment = after.comments[0];
  if (comment === undefined) throw new Error("Missing fixture comment");
  after.comments.push({ ...comment, id: "late-comment", body: "Late comment" });
  const previous = await planMigration(before, migrationActor);
  const next = await planMigration(after, migrationActor);
  const plan = planCatchUp(previous.records, next.records);
  expect(plan.updates).toHaveLength(1);
  expect(plan.additions.map((record) => record.entityType)).toEqual([
    "comment",
  ]);
  const changed = structuredClone(next.records);
  const edited = changed.find((record) => record.entityType === "issue");
  if (edited?.entityType !== "issue") throw new Error("Missing planned issue");
  edited.data.title = "Unreviewed edit";
  expect(planCatchUp(previous.records, changed).updates).toHaveLength(1);
  edited.data.createdAt = "2030-01-01T00:00:00.000Z";
  expect(() => planCatchUp(previous.records, changed)).toThrow(
    "identity or creation time",
  );
  expect(() =>
    planCatchUp(
      previous.records,
      next.records.filter((record) => record.entityType !== "relation"),
    ),
  ).toThrow("removed");
});
