import type { Prisma } from "#generated/prisma/client.ts";
import { TrackerError } from "#domain/error.ts";
import { MAX_ISSUE_DEPTH, parseIdentifier } from "#domain/issue.ts";
import { lockIssue } from "./issue-repository.ts";

/**
 * Serializes every change to a team's issue hierarchy: creating an issue,
 * re-parenting one and deleting one all hold the team row first. Parents and
 * children share a team, so two transactions can never build a cycle or
 * exceed the depth limit between them. Take it before any state or issue
 * lock.
 */
export async function lockHierarchy(
  db: Prisma.TransactionClient,
  teamId: string,
) {
  await db.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`;
}

/** Issue rows are always locked in ascending ID order. */
export async function lockIssues(db: Prisma.TransactionClient, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) await lockIssue(db, id);
}

export async function findParentId(
  db: Prisma.TransactionClient,
  reference: string | null | undefined,
) {
  if (reference === undefined) return;
  if (reference === null) return null;
  const { teamKey, number } = parseIdentifier(reference);
  const parent = await db.issue.findFirst({
    where: { team: { key: teamKey }, number },
    select: { id: true },
  });
  if (parent === null)
    throw new TrackerError("BAD_REQUEST", `Unknown parent issue ${reference}`);
  return parent.id;
}

async function hierarchyNode(db: Prisma.TransactionClient, id: string) {
  return db.issue.findUniqueOrThrow({
    where: { id },
    select: { id: true, teamId: true, parentId: true, archivedAt: true },
  });
}

/** Levels from `id` down to its deepest descendant, archived ones included. */
async function subtreeHeight(db: Prisma.TransactionClient, id: string) {
  let level = [id];
  for (let height = 1; height <= MAX_ISSUE_DEPTH; height += 1) {
    const children = await db.issue.findMany({
      where: { parentId: { in: level } },
      select: { id: true },
    });
    if (children.length === 0) return height;
    level = children.map((child) => child.id);
  }
  throw new Error("Issue hierarchy exceeds its depth limit");
}

/**
 * Rejects a parent that is in another team, archived, the issue itself, one
 * of its descendants, or too deep. `child.id` is null for an issue that does
 * not exist yet. The caller holds the hierarchy lock.
 */
export async function assertParent(
  db: Prisma.TransactionClient,
  child: { id: string | null; teamId: string },
  parentId: string,
) {
  if (parentId === child.id)
    throw new TrackerError("BAD_REQUEST", "An issue cannot be its own parent");
  const parent = await hierarchyNode(db, parentId);
  if (parent.teamId !== child.teamId)
    throw new TrackerError(
      "BAD_REQUEST",
      "A sub-issue and its parent must belong to the same team",
    );
  if (parent.archivedAt !== null)
    throw new TrackerError(
      "BAD_REQUEST",
      "An archived issue cannot take new sub-issues",
    );
  let depth = 1;
  for (let node = parent; node.parentId !== null; depth += 1) {
    if (depth >= MAX_ISSUE_DEPTH)
      throw new Error("Issue hierarchy exceeds its depth limit");
    if (node.parentId === child.id)
      throw new TrackerError(
        "BAD_REQUEST",
        "An issue cannot become a sub-issue of its own descendant",
      );
    node = await hierarchyNode(db, node.parentId);
  }
  const height = child.id === null ? 1 : await subtreeHeight(db, child.id);
  if (depth + height > MAX_ISSUE_DEPTH)
    throw new TrackerError(
      "BAD_REQUEST",
      `Sub-issues nest at most ${String(MAX_ISSUE_DEPTH)} levels deep`,
    );
}
