import { Prisma } from "#generated/prisma/client.ts";
import type { WorkflowState } from "#generated/prisma/client.ts";
import type { MutationContext } from "#application/unit-of-work.ts";
import { TrackerError } from "#domain/error.ts";
import {
  identifier,
  parseIdentifier,
  transitionTimestamps,
} from "#domain/issue.ts";
import type { UpdateIssueInput } from "#shared/schema.ts";
import {
  assertParent,
  findParentId,
  lockHierarchy,
  lockIssues,
} from "./issue-hierarchy.ts";
import {
  addLabels,
  audit,
  commitAttachments,
  dueDateColumn,
  findIssue,
  issueInclude,
  presentIssue,
  resolveAssignee,
  resolveProject,
  resolveState,
  type IssueRecord,
} from "./issue-repository.ts";

/** The fields one update changes; a bulk update applies them to every issue. */
type IssueChange = Omit<
  UpdateIssueInput,
  "actor" | "identifier" | "expectedRevision"
>;
type UpdateTarget = {
  before: IssueRecord;
  state: WorkflowState;
  parentId: string | null | undefined;
};
type Db = Prisma.TransactionClient;

const listed = (identifiers: string[]) => identifiers.join(", ");

/** Prefixes an expected failure with the issues it applies to. */
async function naming<T>(identifiers: string[], work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TrackerError)
      throw new TrackerError(
        error.code,
        `${listed(identifiers)}: ${error.message}`,
      );
    throw error;
  }
}

/** The named issues in the order given; any missing one is `NOT_FOUND`. */
async function findIssues(db: Db, identifiers: string[]) {
  const rows = await db.issue.findMany({
    where: {
      OR: identifiers.map((reference) => {
        const { teamKey, number } = parseIdentifier(reference);
        return { team: { key: teamKey }, number };
      }),
    },
    include: issueInclude,
  });
  const byIdentifier = new Map(
    rows.map((row) => [identifier(row.team.key, row.number), row]),
  );
  const found = identifiers.map((reference) => byIdentifier.get(reference));
  const missing = identifiers.filter((_, index) => found[index] === undefined);
  if (missing.length > 0)
    throw new TrackerError(
      "NOT_FOUND",
      `${missing.length === 1 ? "Issue" : "Issues"} ${listed(missing)} not found`,
    );
  return found.filter((row) => row !== undefined);
}

/**
 * Locks every issue an update names and re-reads it, in the order every
 * issue mutation shares: the team rows (only to re-parent), the workflow
 * states, then the issue rows by ascending ID.
 */
async function lockTargets(
  db: Db,
  identifiers: string[],
  change: IssueChange,
  expectedRevisions: Record<string, number>,
): Promise<UpdateTarget[]> {
  const initial = await findIssues(db, identifiers);
  const teams = Map.groupBy(initial, (issue) => issue.teamId);
  if (change.parentIdentifier !== undefined)
    for (const teamId of [...teams.keys()].sort())
      await lockHierarchy(db, teamId);
  const parentId = await findParentId(db, change.parentIdentifier);
  // States are team-scoped: every team must have the requested one.
  const states = new Map<string, WorkflowState>();
  if (change.stateName !== undefined || change.stateType !== undefined)
    for (const [teamId, members] of teams)
      states.set(
        teamId,
        await naming(
          members.map((issue) => identifier(issue.team.key, issue.number)),
          () => resolveState(db, teamId, change),
        ),
      );
  const stateIds = new Set([
    ...initial.map((issue) => issue.stateId),
    ...[...states.values()].map((state) => state.id),
  ]);
  await db.$queryRaw`SELECT "id" FROM "WorkflowState" WHERE "id" IN (${Prisma.join([...stateIds].sort())}) ORDER BY "id" FOR UPDATE`;
  const newParent = typeof parentId === "string" ? [parentId] : [];
  await lockIssues(db, [...initial.map(({ id }) => id), ...newParent]);
  const current = await findIssues(db, identifiers);
  const initialStates = new Map(
    initial.map(({ id, stateId }) => [id, stateId]),
  );
  const subject = (affected: IssueRecord[]) =>
    identifiers.length === 1
      ? "This issue"
      : listed(
          affected.map((issue) => identifier(issue.team.key, issue.number)),
        );
  const moved = current.filter(
    (issue) => issue.stateId !== initialStates.get(issue.id),
  );
  if (moved.length > 0)
    throw new TrackerError(
      "CONFLICT",
      `${subject(moved)} moved. Reload before saving.`,
    );
  const stale = current.filter((issue) => {
    const expected =
      expectedRevisions[identifier(issue.team.key, issue.number)];
    return expected !== undefined && expected !== issue.revision;
  });
  if (stale.length > 0)
    throw new TrackerError(
      "CONFLICT",
      `${subject(stale)} changed. Reload before saving.`,
    );
  return current.map((before) => ({
    before,
    // An update that names no state keeps the issue's current one.
    state: states.get(before.teamId) ?? before.state,
    parentId,
  }));
}

/** Applies a change to one locked issue and records its `updated` event. */
async function applyUpdate(
  context: MutationContext,
  { before, state, parentId }: UpdateTarget,
  change: IssueChange,
) {
  const { db } = context;
  const reference = identifier(before.team.key, before.number);
  // Re-sending the current parent changes nothing and is not re-checked.
  if (typeof parentId === "string" && parentId !== before.parentId)
    await assertParent(db, before, parentId);
  const projectId = await resolveProject(db, change.projectSlug);
  const assigneeId = await resolveAssignee(db, change.assigneeKey);
  await db.issue.update({
    where: { id: before.id },
    data: {
      ...(change.title === undefined ? {} : { title: change.title }),
      ...(change.description === undefined
        ? {}
        : { description: change.description }),
      ...(change.priority === undefined ? {} : { priority: change.priority }),
      ...(projectId === undefined ? {} : { projectId }),
      ...(assigneeId === undefined ? {} : { assigneeId }),
      ...(parentId === undefined ? {} : { parentId }),
      ...(change.dueDate === undefined
        ? {}
        : { dueDate: dueDateColumn(change.dueDate) }),
      ...(change.archived === undefined
        ? {}
        : { archivedAt: change.archived ? new Date() : null }),
      stateId: state.id,
      revision: { increment: 1 },
      ...transitionTimestamps(state.type, before, new Date()),
    },
  });
  await db.issueLabel.deleteMany({
    where: {
      issueId: before.id,
      label: { name: { in: change.removeLabels } },
    },
  });
  await addLabels(db, before.id, before.teamId, change.addLabels);
  await commitAttachments(context, change.attachmentIds, before.id);
  const result = presentIssue(await findIssue(db, reference));
  await audit(context, {
    entityType: "issue",
    entityId: before.id,
    issueId: before.id,
    issueIdentifier: reference,
    action: "updated",
    before: presentIssue(before),
    after: result,
  });
  return result;
}

/**
 * Applies one change to every named issue inside the caller's transaction,
 * in the order given. Each issue gets its own revision and `updated` event;
 * any failure names the issue and rolls back the whole request.
 */
export async function updateIssues(
  context: MutationContext,
  identifiers: string[],
  change: IssueChange,
  expectedRevisions: Record<string, number>,
) {
  const targets = await lockTargets(
    context.db,
    identifiers,
    change,
    expectedRevisions,
  );
  const results = [];
  for (const target of targets)
    results.push(
      await naming(
        [identifier(target.before.team.key, target.before.number)],
        () => applyUpdate(context, target, change),
      ),
    );
  return results;
}
