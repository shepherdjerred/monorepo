import type { z } from "zod";
import {
  ImportRecordSchema,
  importId,
  type ActorEnvelope,
} from "@shepherdjerred/tracker/contract";
import { hash, inlineFiles, isLinearFile } from "./files.ts";
import type { ExportFile, LinearExport } from "./schema.ts";

export type MigrationRecord = z.infer<typeof ImportRecordSchema>;
type MigrationPlan = {
  records: MigrationRecord[];
  attachments: Map<string, ExportFile>;
};
import { json, lookup, slug, sourceActor, voteActor } from "./identity.ts";

function createContext(snapshot: LinearExport, actor: ActorEnvelope) {
  if (
    snapshot.projects.some(
      (project) =>
        inlineFiles(project.description + "\n" + (project.content ?? ""))
          .length > 0,
    )
  )
    throw new Error(
      "Project upload links require an explicit destination association before import",
    );
  const records: MigrationRecord[] = [];
  const record = (
    entityType: string,
    externalId: string,
    data: unknown,
    rawSourcePayload: unknown,
  ) => {
    records.push(
      ImportRecordSchema.parse({
        actor,
        source: "linear",
        entityType,
        externalId,
        data,
        rawSourcePayload: json(rawSourcePayload),
      }),
    );
  };
  const teams = new Map(snapshot.teams.map((team) => [team.id, team.key]));
  const states = new Map(snapshot.states.map((state) => [state.id, state]));
  const stateNames = new Set(
    snapshot.states.map(
      (state) => state.team.id + ":" + state.name.toLowerCase(),
    ),
  );
  if (stateNames.size !== snapshot.states.length)
    throw new Error("Exported state names differ only by capitalization");
  const labels = new Map(snapshot.labels.map((label) => [label.id, label]));
  const projects = new Map(
    snapshot.projects.map((project) => [project.id, slug(project.name)]),
  );
  if (new Set(projects.values()).size !== snapshot.projects.length)
    throw new Error("Linear project names produce colliding slugs");
  const issues = new Map(
    snapshot.issues.map((issue) => [issue.id, issue.identifier]),
  );
  if (
    issues.size !== snapshot.issues.length ||
    new Set(issues.values()).size !== snapshot.issues.length
  )
    throw new Error("Export contains duplicate issue identities");

  return { snapshot, records, record, teams, states, labels, projects, issues };
}

type Context = ReturnType<typeof createContext>;

function collectSources(context: Context) {
  const { snapshot, issues } = context;
  type AttachmentSource = {
    identifier: string;
    comment: string | null;
    url: string;
    id: string;
    createdAt: string;
    user: string | null;
    raw: unknown;
  };
  const sources = new Map<string, AttachmentSource>();
  const addFile = (file: AttachmentSource) => {
    const scope =
      file.identifier + "\n" + (file.comment ?? "") + "\n" + file.url;
    if (!sources.has(scope)) sources.set(scope, file);
  };
  for (const file of snapshot.attachments) {
    lookup(issues, file.issue.id, "attachment issue");
    if (isLinearFile(file.url))
      addFile({
        identifier: file.issue.identifier,
        comment: null,
        url: file.url,
        id: file.id,
        createdAt: file.createdAt,
        user: file.creator?.id ?? null,
        raw: file,
      });
  }
  for (const issue of snapshot.issues)
    for (const url of inlineFiles(issue.description ?? ""))
      addFile({
        identifier: issue.identifier,
        comment: null,
        url,
        id: "inline:" + issue.id + ":" + hash(url),
        createdAt: issue.createdAt,
        user: issue.creator?.id ?? null,
        raw: { ownerId: issue.id, url },
      });
  for (const comment of snapshot.comments) {
    if (comment.issue === null) continue; // Project/document comments remain in the private export.
    lookup(issues, comment.issue.id, "comment issue");
    for (const url of inlineFiles(comment.body))
      addFile({
        identifier: comment.issue.identifier,
        comment: comment.id,
        url,
        id: "inline:" + comment.id + ":" + hash(url),
        createdAt: comment.createdAt,
        user: comment.user?.id ?? null,
        raw: { ownerId: comment.id, url },
      });
  }
  return sources;
}

async function prepareFiles(context: Context) {
  const { snapshot } = context;
  const sources = collectSources(context);
  const attachments = new Map<string, ExportFile>();
  const files = new Map(snapshot.files.map((file) => [file.url, file]));
  if (files.size !== snapshot.files.length)
    throw new Error("Duplicate exported file URL");
  const replacements = new Map<string, Map<string, string>>();
  for (const file of sources.values()) {
    const bytes = lookup(files, file.url, "file");
    const id = await importId("linear", "attachment", file.id);
    attachments.set(file.id, bytes);
    const owner = file.comment ?? file.identifier;
    const entries = replacements.get(owner) ?? new Map<string, string>();
    entries.set(
      file.url,
      "/attachments/" + id + "/" + encodeURIComponent(bytes.filename),
    );
    replacements.set(owner, entries);
  }
  const rewrite = (body: string, owner: string) => {
    let value = body;
    for (const [before, after] of replacements.get(owner) ?? [])
      value = value.replaceAll(before, after);
    return value.replaceAll(
      /https:\/\/linear\.app\/([^/\s]+)\/issue\/((?:AI|SJ)-\d+)(?:\/[a-z0-9-]+)?/giu,
      (url: string, workspace: string, identifier: string) =>
        workspace === snapshot.workspace.urlKey &&
        [...context.issues.values()].includes(identifier.toUpperCase())
          ? "/issues/" + identifier.toUpperCase()
          : url,
    );
  };
  return { sources, files, attachments, rewrite };
}
type Files = Awaited<ReturnType<typeof prepareFiles>>;

function appendTeam(team: LinearExport["teams"][number], context: Context) {
  const { snapshot, record } = context;
  const maximum = Math.max(
    0,
    ...snapshot.issues
      .filter((issue) => issue.team.id === team.id)
      .map((issue) => issue.number),
  );
  record(
    "team",
    team.id,
    { key: team.key, name: team.name, issueCounter: maximum },
    team,
  );
  const ordered = snapshot.states
    .filter((state) => state.team.id === team.id)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  for (const [position, state] of ordered.entries())
    record(
      "state",
      state.id,
      {
        teamKey: team.key,
        name: state.name,
        type: state.type,
        color: state.color,
        position,
      },
      state,
    );
  const names = new Map<string, string>();
  for (const label of snapshot.labels.filter(
    (item) => item.team === null || item.team.id === team.id,
  )) {
    if (names.has(label.name) && names.get(label.name) !== label.color)
      throw new Error("Conflicting workspace/team label colors: " + label.name);
    names.set(label.name, label.color);
    record(
      "label",
      label.id + ":" + team.key,
      { teamKey: team.key, name: label.name, color: label.color },
      label,
    );
  }
}

function appendProjects(context: Context) {
  const { snapshot, record, projects } = context;
  for (const project of snapshot.projects)
    record(
      "project",
      project.id,
      {
        slug: lookup(projects, project.id, "project"),
        name: project.name,
        description: [
          ...new Set(
            [project.description, project.content].filter(
              (value) => value !== null && value !== "",
            ),
          ),
        ].join("\n\n"),
        color: project.color,
        archivedAt: project.archivedAt,
      },
      project,
    );
}

function appendActors(context: Context) {
  const { snapshot, record } = context;
  const actorKeys = new Set<string>();
  const addActor = (
    envelope: ActorEnvelope,
    firstSeenAt: string,
    lastSeenAt: string,
    raw: unknown,
  ) => {
    if (actorKeys.has(envelope.key)) return;
    actorKeys.add(envelope.key);
    record("actor", envelope.key, { envelope, firstSeenAt, lastSeenAt }, raw);
  };
  for (const user of snapshot.users)
    addActor(
      sourceActor(snapshot, user.id),
      user.createdAt,
      user.updatedAt,
      user,
    );
  addActor(
    sourceActor(snapshot, null),
    snapshot.exportedAt,
    snapshot.exportedAt,
    { deletedAuthor: true },
  );
  for (const comment of snapshot.comments) {
    if (comment.issue === null) continue;
    const vote = voteActor(comment.body, comment.id);
    if (vote !== null)
      addActor(vote, comment.createdAt, comment.updatedAt, {
        commentId: comment.id,
        body: comment.body,
      });
  }
}

function appendIssue(
  issue: LinearExport["issues"][number],
  context: Context,
  filePlan: Files,
) {
  const { snapshot, record, teams, states, projects, labels } = context;
  const { rewrite } = filePlan;
  const teamKey = lookup(teams, issue.team.id, "team");
  if (issue.identifier !== teamKey + "-" + issue.number.toString())
    throw new Error(
      "Issue identifier disagrees with its exported team and number",
    );
  const state = lookup(states, issue.state.id, "state");
  if (state.team.id !== issue.team.id)
    throw new Error("Issue state crosses teams");
  const links = snapshot.attachments
    .filter((file) => file.issue.id === issue.id && !isLinearFile(file.url))
    .map(
      (file) =>
        "[" +
        file.title
          .replaceAll("[", String.raw`\[`)
          .replaceAll("]", String.raw`\]`) +
        "](<" +
        file.url +
        ">)",
    );
  const description =
    rewrite(issue.description ?? "", issue.identifier) +
    (links.length === 0
      ? ""
      : "\n\n### Original attachments\n\n" + links.join("\n\n"));
  record(
    "issue",
    issue.id,
    {
      identifier: issue.identifier,
      title: issue.title,
      description,
      stateName: state.name,
      priority: issue.priority,
      projectSlug:
        issue.project === null
          ? null
          : lookup(projects, issue.project.id, "project"),
      creatorKey: sourceActor(snapshot, issue.creator?.id ?? null).key,
      assigneeKey:
        issue.assignee === null
          ? null
          : sourceActor(snapshot, issue.assignee.id).key,
      labels: issue.labelIds.map((id) => {
        const label = lookup(labels, id, "label");
        if (label.team !== null && label.team.id !== issue.team.id)
          throw new Error("Issue label crosses teams");
        return label.name;
      }),
      boardOrder: issue.sortOrder,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      startedAt: issue.startedAt,
      completedAt: issue.completedAt,
      canceledAt: issue.canceledAt,
      archivedAt: issue.archivedAt,
    },
    {
      ...issue,
      attachments: snapshot.attachments.filter(
        (file) => file.issue.id === issue.id,
      ),
    },
  );
}

function appendComments(context: Context, filePlan: Files) {
  const { snapshot, record } = context;
  const { rewrite } = filePlan;
  for (const comment of snapshot.comments) {
    if (comment.issue === null) continue;
    record(
      "comment",
      comment.id,
      {
        identifier: comment.issue.identifier,
        authorKey: sourceActor(snapshot, comment.user?.id ?? null).key,
        body: rewrite(comment.body, comment.id),
        createdAt: comment.createdAt,
        editedAt: comment.editedAt,
      },
      comment,
    );
  }
}

function appendRelations(context: Context) {
  const { snapshot, record, issues } = context;
  for (const relation of snapshot.relations) {
    lookup(issues, relation.issue.id, "relation source");
    lookup(issues, relation.relatedIssue.id, "relation target");
    record(
      "relation",
      relation.id,
      {
        from: relation.issue.identifier,
        to: relation.relatedIssue.identifier,
        type: relation.type,
      },
      relation,
    );
  }
}

function appendVotes(context: Context) {
  const { snapshot, record } = context;
  for (const comment of snapshot.comments) {
    if (comment.issue === null) continue;
    const voter = voteActor(comment.body, comment.id);
    if (voter !== null)
      record(
        "vote",
        comment.id,
        {
          identifier: comment.issue.identifier,
          actorKey: voter.key,
          note: comment.body,
          createdAt: comment.createdAt,
        },
        comment,
      );
  }
}

function appendHistory(context: Context) {
  const { snapshot, record } = context;
  for (const issue of snapshot.issues)
    record(
      "event",
      "issue:" + issue.id,
      {
        identifier: issue.identifier,
        entityType: "issue",
        entityExternalId: issue.id,
        action: "imported-from-linear",
        actorKey: sourceActor(snapshot, issue.creator?.id ?? null).key,
        occurredAt: issue.createdAt,
        changes: {},
        before: null,
        after: {
          originalCreatedAt: issue.createdAt,
          originalUpdatedAt: issue.updatedAt,
          originalArchivedAt: issue.archivedAt,
        },
      },
      issue,
    );
}

function appendFiles(context: Context, filePlan: Files) {
  const { snapshot, record } = context;
  const { sources, files } = filePlan;
  for (const file of sources.values()) {
    const bytes = lookup(files, file.url, "file");
    record(
      "attachment",
      file.id,
      {
        identifier: file.identifier,
        commentExternalId: file.comment,
        uploaderKey: sourceActor(snapshot, file.user).key,
        filename: bytes.filename,
        contentType: bytes.contentType,
        sizeBytes: bytes.sizeBytes,
        sha256: bytes.sha256,
        width: null,
        height: null,
        createdAt: file.createdAt,
        contentBase64: "",
      },
      file.raw,
    );
  }
}

export async function planMigration(
  snapshot: LinearExport,
  actor: ActorEnvelope,
): Promise<MigrationPlan> {
  const context = createContext(snapshot, actor);
  const files = await prepareFiles(context);
  for (const team of snapshot.teams) appendTeam(team, context);
  appendProjects(context);
  appendActors(context);
  for (const issue of snapshot.issues) appendIssue(issue, context, files);
  appendComments(context, files);
  appendRelations(context);
  appendVotes(context);
  appendHistory(context);
  appendFiles(context, files);
  return { records: context.records, attachments: files.attachments };
}
