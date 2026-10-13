import { expect, test, vi } from "vitest";
import { importId } from "@shepherdjerred/tracker/contract";
import { planMigration } from "#lib/tracker/migration/normalize.ts";
import { voteActor } from "#lib/tracker/migration/identity.ts";
import { snapshotChanges } from "#lib/tracker/migration/verify.ts";
import { connection, type LinearQuery } from "#lib/tracker/migration/source.ts";
import { migrationFixture, migrationActor } from "./migration-fixture.ts";

test("exports every page including archived data and rejects repeated cursors", async () => {
  const query = vi
    .fn<LinearQuery>()
    .mockResolvedValueOnce({
      data: {
        issues: {
          nodes: [{ id: "first" }],
          pageInfo: { hasNextPage: true, endCursor: "next" },
        },
      },
    })
    .mockResolvedValueOnce({
      data: {
        issues: {
          nodes: [{ id: "archived" }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });
  expect(await connection(query, "issues", "id")).toEqual([
    { id: "first" },
    { id: "archived" },
  ]);
  expect(query.mock.calls[0]?.[0]).toContain("includeArchived: true");
  expect(query.mock.calls[1]?.[1]).toEqual({ after: "next" });
  query.mockResolvedValue({
    data: {
      issues: {
        nodes: [],
        pageInfo: { hasNextPage: true, endCursor: "repeat" },
      },
    },
  });
  await expect(connection(query, "issues", "id")).rejects.toThrow(
    "invalid pagination cursor",
  );
});

test("preserves identities, authors, timestamps, raw metadata and attachment destinations", async () => {
  const snapshot = migrationFixture();
  const plan = await planMigration(snapshot, migrationActor);
  const issue = plan.records.find(
    (record) =>
      record.entityType === "issue" && record.data.identifier === "AI-186",
  );
  if (issue?.entityType !== "issue") throw new Error("Missing planned issue");
  const destination = await importId("linear", "attachment", "file");
  expect(issue.data.description).toContain(
    "/attachments/" + destination + "/proof.txt",
  );
  expect(issue.data.description).toContain(
    "https://github.com/example/repo/pull/1",
  );
  expect(issue.data.creatorKey).toBe("import:linear");
  expect(issue.data.archivedAt).toBe(snapshot.issues[0]?.archivedAt);
  expect(issue.rawSourcePayload["cycle"]).toEqual({ number: 7 });
  expect(issue.rawSourcePayload["attachments"]).toHaveLength(2);
  expect(
    plan.records.filter((record) => record.entityType === "attachment"),
  ).toHaveLength(2);
  expect(
    plan.records.find(
      (record) => record.entityType === "team" && record.data.key === "AI",
    ),
  ).toMatchObject({ data: { issueCounter: 186 } });
  expect(
    plan.records.find(
      (record) =>
        record.entityType === "issue" && record.data.identifier === "SJ-171",
    ),
  ).toMatchObject({ data: { description: "See /issues/AI-186" } });
  expect(
    plan.records.find((record) => record.entityType === "vote"),
  ).toMatchObject({ data: { actorKey: "codex:session-1" } });
  expect(
    plan.records.find((record) => record.entityType === "project"),
  ).toMatchObject({ data: { description: "Summary\n\nFull project details" } });
});

test("unknown sessions stay distinct and literal-newline votes keep known sessions", () => {
  const body = "+1 hit again\n- Session: unknown\n- Harness: codex";
  expect(voteActor(body, "first")?.key).not.toBe(
    voteActor(body, "second")?.key,
  );
  expect(
    voteActor(
      String.raw`+1 hit again\n- Session: known\n- Harness: claude-code`,
      "third",
    )?.key,
  ).toBe("claude-code:known");
  expect(voteActor("Normal comment", "fourth")).toBeNull();
});

test("fails preflight for missing files, references and colliding project names", async () => {
  const snapshot = migrationFixture();
  snapshot.files = [];
  await expect(planMigration(snapshot, migrationActor)).rejects.toThrow(
    "Missing exported file",
  );
  const missing = migrationFixture();
  missing.labels = [];
  await expect(planMigration(missing, migrationActor)).rejects.toThrow(
    "Missing exported label",
  );
  const project = missing.projects[0];
  if (project === undefined) throw new Error("Missing fixture project");
  const collision = migrationFixture();
  collision.projects.push({ ...project, id: "other-project" });
  await expect(planMigration(collision, migrationActor)).rejects.toThrow(
    "colliding slugs",
  );
});

test("source verification ignores export time and root ordering but detects late edits", () => {
  const original = migrationFixture();
  const latest = migrationFixture();
  latest.exportedAt = "2026-01-02T03:04:05.000Z";
  latest.issues.reverse();
  expect(snapshotChanges(original, latest)).toEqual({});
  const issue = latest.issues[0];
  if (issue === undefined) throw new Error("Missing fixture issue");
  issue.title = "A late Linear edit";
  expect(snapshotChanges(original, latest)).toEqual({
    issues: { added: 0, removed: 0, changed: 1 },
  });
});

test("leaves links to other Linear workspaces intact and refuses unmapped project uploads", async () => {
  const snapshot = migrationFixture();
  const issue = snapshot.issues[0];
  const project = snapshot.projects[0];
  if (issue === undefined || project === undefined)
    throw new Error("Missing fixture");
  issue.description = "https://linear.app/other/issue/AI-186/external";
  const plan = await planMigration(snapshot, migrationActor);
  expect(
    plan.records.find(
      (record) =>
        record.entityType === "issue" && record.data.identifier === "AI-186",
    ),
  ).toMatchObject({
    data: {
      description: expect.stringContaining(
        "https://linear.app/other/issue/AI-186/external",
      ),
    },
  });
  project.content = "![](https://uploads.linear.app/project/proof)";
  await expect(planMigration(snapshot, migrationActor)).rejects.toThrow(
    "explicit destination association",
  );
});
