import {
  queryLinearHistory as linearQuery,
  type LinearQuery,
} from "./linear-source.ts";
import { z } from "zod";
import { LinearExportSchema, type LinearExport } from "./schema.ts";

const PageSchema = z.object({
  nodes: z.array(z.record(z.string(), z.json())),
  pageInfo: z.object({
    hasNextPage: z.boolean(),
    endCursor: z.string().nullable(),
  }),
});

export async function connection(
  query: LinearQuery,
  field: string,
  selection: string,
) {
  const nodes: z.infer<typeof PageSchema>["nodes"] = [];
  let after: string | null = null;
  const cursors = new Set<string>();
  for (;;) {
    const response = await query(
      "query Export($after: String) { " +
        field +
        "(first: 100, after: $after, includeArchived: true" +
        (field === "users" ? ", includeDisabled: true" : "") +
        ") { nodes { " +
        selection +
        " } pageInfo { hasNextPage endCursor } } }",
      { after },
    );
    const data = z
      .object({ data: z.record(z.string(), z.unknown()) })
      .parse(response);
    const page = PageSchema.parse(data.data[field]);
    nodes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return nodes;
    after = page.pageInfo.endCursor;
    if (after === null || cursors.has(after))
      throw new Error(
        "Linear returned an invalid pagination cursor for " + field,
      );
    cursors.add(after);
  }
}

const fields = {
  teams: "id key name createdAt updatedAt",
  workflowStates: "id name type color position team { id }",
  issueLabels: "id name color team { id }",
  projects: "id name description content color archivedAt createdAt updatedAt",
  users: "id name displayName app createdAt updatedAt",
  issues:
    "id identifier number title description priority sortOrder team { id } state { id } project { id } creator { id } assignee { id } labelIds createdAt updatedAt startedAt completedAt canceledAt archivedAt dueDate estimate parent { id identifier } cycle { id number name } url",
  comments:
    "id body createdAt updatedAt editedAt user { id } issue { id identifier } parentId archivedAt url",
  issueRelations:
    "id type issue { id identifier } relatedIssue { id identifier }",
  attachments:
    "id title url createdAt updatedAt creator { id } issue { id identifier } metadata subtitle",
} as const;

export async function exportLinear(
  query: LinearQuery = linearQuery,
): Promise<LinearExport> {
  const workspace = z
    .object({
      data: z.object({
        organization: LinearExportSchema.shape.workspace,
        viewer: z.object({ id: z.string() }),
      }),
    })
    .parse(
      await query(
        "query { organization { id name urlKey } viewer { id } }",
        {},
      ),
    );
  const result: Record<string, unknown> = {};
  for (const [field, selection] of Object.entries(fields)) {
    result[field] = await connection(query, field, selection);
    console.error(
      "Exported " +
        field +
        ": " +
        z.array(z.unknown()).parse(result[field]).length.toString(),
    );
  }
  return LinearExportSchema.parse({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    sharedUserId: workspace.data.viewer.id,
    workspace: workspace.data.organization,
    teams: result["teams"],
    states: result["workflowStates"],
    labels: result["issueLabels"],
    projects: result["projects"],
    users: result["users"],
    issues: result["issues"],
    comments: result["comments"],
    relations: result["issueRelations"],
    attachments: result["attachments"],
    files: [],
  });
}
