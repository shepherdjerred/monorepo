import { ActorSchema } from "@shepherdjerred/tracker/contract";
import { LinearExportSchema } from "#lib/tracker/migration/schema.ts";
import { hash } from "#lib/tracker/migration/files.ts";

export const migrationActor = ActorSchema.parse({
  key: "codex:migration-session",
  kind: "agent",
  name: "Codex",
  metadata: {},
});
export const fileBytes = Buffer.from("historical attachment");
const timestamp = "2025-01-02T03:04:05.000Z";
const dates = { createdAt: timestamp, updatedAt: timestamp };
const url = "https://uploads.linear.app/workspace/proof.txt";
export function migrationFixture() {
  const issue = {
    ...dates,
    number: 186,
    title: "Original issue",
    description: "![](" + url + ")",
    priority: 2,
    sortOrder: 1024,
    team: { id: "ai" },
    state: { id: "started" },
    project: { id: "dx" },
    creator: { id: "shared" },
    assignee: null,
    labelIds: ["global"],
    startedAt: timestamp,
    completedAt: null,
    canceledAt: null,
    archivedAt: timestamp,
    parent: null,
    cycle: { number: 7 },
  };
  return LinearExportSchema.parse({
    schemaVersion: 1,
    exportedAt: timestamp,
    sharedUserId: "shared",
    workspace: { id: "workspace", name: "Monorepo", urlKey: "sjerred" },
    teams: [
      { ...dates, id: "ai", key: "AI", name: "Agents" },
      { ...dates, id: "sj", key: "SJ", name: "Jerred" },
    ],
    states: [
      {
        id: "started",
        name: "In Progress",
        type: "started",
        position: 0.25,
        color: "#123456",
        team: { id: "ai" },
      },
      {
        id: "sj-started",
        name: "In Progress",
        type: "started",
        position: 0.5,
        color: "#123456",
        team: { id: "sj" },
      },
    ],
    labels: [
      { id: "global", name: "Improvement", color: "#123456", team: null },
    ],
    projects: [
      {
        ...dates,
        id: "dx",
        name: "Developer Experience",
        description: "Summary",
        content: "Full project details",
        color: "#123456",
        archivedAt: null,
      },
    ],
    users: [
      {
        ...dates,
        id: "shared",
        name: "Jerred",
        displayName: "sjerred",
        app: false,
      },
    ],
    issues: [
      { ...issue, id: "issue-ai", identifier: "AI-186" },
      {
        ...issue,
        id: "issue-sj",
        identifier: "SJ-171",
        number: 171,
        team: { id: "sj" },
        state: { id: "sj-started" },
        description:
          "See https://linear.app/sjerred/issue/AI-186/original-issue",
      },
    ],
    comments: [
      {
        ...dates,
        id: "comment",
        body:
          "+1 hit again\n\n- Session: session-1\n- Harness: codex\n- Model: model-1\n\n![](" +
          url +
          ")",
        editedAt: timestamp,
        issue: { id: "issue-ai", identifier: "AI-186" },
        user: { id: "shared" },
      },
    ],
    relations: [
      {
        id: "relation",
        type: "blocks",
        issue: { id: "issue-ai", identifier: "AI-186" },
        relatedIssue: { id: "issue-sj", identifier: "SJ-171" },
      },
    ],
    attachments: [
      {
        ...dates,
        id: "file",
        title: "Proof",
        url,
        issue: { id: "issue-ai", identifier: "AI-186" },
        creator: { id: "shared" },
        metadata: { original: true },
      },
      {
        ...dates,
        id: "link",
        title: "Original PR",
        url: "https://github.com/example/repo/pull/1",
        issue: { id: "issue-ai", identifier: "AI-186" },
        creator: { id: "shared" },
        metadata: {},
      },
    ],
    files: [
      {
        url,
        path: "files/" + hash(fileBytes),
        filename: "proof.txt",
        contentType: "text/plain",
        sizeBytes: fileBytes.length,
        sha256: hash(fileBytes),
      },
    ],
  });
}
