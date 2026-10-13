import { ActorSchema } from "#shared/actor.ts";
import { ImportRecordSchema } from "#shared/import-schema.ts";

export const migrationActor = ActorSchema.parse({
  key: "import:linear",
  kind: "runner",
  name: "Linear import",
  metadata: { harness: "migration" },
});
export const historicalActor = ActorSchema.parse({
  key: "human:linear-owner",
  kind: "human",
  name: "Original owner",
  metadata: {},
});
const timestamp = "2025-01-02T03:04:05.000Z";
const record = (
  entityType: string,
  externalId: string,
  data: Record<string, unknown>,
) =>
  ImportRecordSchema.parse({
    actor: migrationActor,
    source: "linear",
    entityType,
    externalId,
    data,
    rawSourcePayload: { id: externalId, unsupportedCycle: "preserved" },
  });

export function importFixture() {
  const bytes = Buffer.from("Historical file bytes");
  return [
    record("team", "team-1", { key: "AI", name: "Agents", issueCounter: 150 }),
    record("state", "state-1", {
      teamKey: "AI",
      name: "Imported finished",
      type: "completed",
      color: "#123456",
      position: 8,
    }),
    record("label", "label-1", {
      teamKey: "AI",
      name: "Imported label",
      color: "#123456",
    }),
    record("project", "project-1", {
      slug: "developer-experience",
      name: "Developer Experience",
      description: "Original project",
      color: "#123456",
      archivedAt: null,
    }),
    record("actor", "user-1", {
      envelope: historicalActor,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
    }),
    record("issue", "issue-1", {
      identifier: "AI-150",
      title: "Original archived issue",
      description: "Current description after historical edit",
      stateName: "Imported finished",
      priority: 2,
      projectSlug: "developer-experience",
      creatorKey: historicalActor.key,
      assigneeKey: historicalActor.key,
      labels: ["Imported label"],
      boardOrder: 1024,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: timestamp,
      completedAt: timestamp,
      canceledAt: null,
      archivedAt: timestamp,
    }),
    record("comment", "comment-1", {
      identifier: "AI-150",
      authorKey: historicalActor.key,
      body: "Original comment",
      createdAt: timestamp,
      editedAt: timestamp,
    }),
    record("issue", "issue-2", {
      identifier: "AI-149",
      title: "Related issue",
      description: "",
      stateName: "Triage",
      priority: 0,
      projectSlug: null,
      creatorKey: historicalActor.key,
      assigneeKey: null,
      labels: [],
      boardOrder: 1024,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
      archivedAt: null,
    }),
    record("relation", "relation-1", {
      from: "AI-150",
      to: "AI-149",
      type: "related",
    }),
    record("vote", "vote-1", {
      identifier: "AI-150",
      actorKey: historicalActor.key,
      note: "Original frequency signal",
      createdAt: timestamp,
    }),
    record("event", "history-1", {
      identifier: "AI-150",
      entityType: "issue",
      entityExternalId: "issue-1",
      action: "updated",
      actorKey: historicalActor.key,
      occurredAt: timestamp,
      changes: {
        description: {
          from: "First description",
          to: "Current description after historical edit",
        },
      },
      before: { description: "First description" },
      after: { description: "Current description after historical edit" },
    }),
    record("attachment", "attachment-1", {
      identifier: "AI-150",
      commentExternalId: "comment-1",
      uploaderKey: historicalActor.key,
      filename: "proof.txt",
      contentType: "text/plain",
      sizeBytes: bytes.length,
      sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      width: null,
      height: null,
      createdAt: timestamp,
      contentBase64: bytes.toString("base64"),
    }),
  ];
}
