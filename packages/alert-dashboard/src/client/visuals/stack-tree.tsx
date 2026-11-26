import { StatusGlyph } from "@shepherdjerred/console-ui";

import { Identifier } from "./identifier.tsx";
import { pillSeverity, type PillTone } from "./pill.ts";

export type StackCheckState =
  | "SUCCESS"
  | "FAILURE"
  | "ERROR"
  | "PENDING"
  | "EXPECTED"
  | "NONE"
  | "passing"
  | "failing"
  | "pending"
  | "none";

export type StackReviewDecision =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REVIEW_REQUIRED"
  | "approved"
  | "changes_requested"
  | "review_required"
  | null;

export type StackMergeableState =
  | "MERGEABLE"
  | "CONFLICTING"
  | "UNKNOWN"
  | "mergeable"
  | "conflicting"
  | "unknown"
  | null;

export type StackPullRequest = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly branch: string;
  readonly baseRefName: string;
  readonly authorLogin: string | null | undefined;
  readonly draft: boolean;
  readonly checks: StackCheckState;
  readonly reviewDecision: StackReviewDecision | undefined;
  readonly exactHeadApproved?: boolean | undefined;
  readonly mergeable: StackMergeableState | undefined;
  readonly ageHours: number;
};

export type StackTreeNode = {
  readonly pr: StackPullRequest;
  readonly depth: number;
  readonly children: readonly StackTreeNode[];
};

export type StackTreeProps = {
  readonly pullRequests: readonly StackPullRequest[];
  readonly label?: string | undefined;
  readonly emptyMessage?: string | undefined;
};

type PillSpec = {
  readonly key: string;
  readonly text: string;
  readonly tone: PillTone;
};

const TRUNK_BRANCHES: ReadonlySet<string> = new Set(["main", "master"]);

/**
 * Builds a forest of stacked `git-spice` PR chains rooted at `main` (or
 * standalone branches whose `baseRefName` is not another open PR's `branch`).
 * Cycles are broken deterministically so every input PR appears once.
 */
export function buildStackForest(
  pullRequests: readonly StackPullRequest[],
): StackTreeNode[] {
  if (pullRequests.length === 0) {
    return [];
  }

  const branchOwner = new Map<string, StackPullRequest>();
  const childrenByBase = new Map<string, StackPullRequest[]>();

  for (const pr of pullRequests) {
    if (!branchOwner.has(pr.branch)) {
      branchOwner.set(pr.branch, pr);
    }
    const siblings = childrenByBase.get(pr.baseRefName);
    if (siblings === undefined) {
      childrenByBase.set(pr.baseRefName, [pr]);
    } else {
      siblings.push(pr);
    }
  }

  const visited = new Set<number>();

  function buildNode(pr: StackPullRequest, depth: number): StackTreeNode {
    visited.add(pr.number);
    const directChildren = (childrenByBase.get(pr.branch) ?? []).filter(
      (candidate) => !visited.has(candidate.number),
    );
    return {
      pr,
      depth,
      children: directChildren.map((child) => buildNode(child, depth + 1)),
    };
  }

  const roots = pullRequests.filter(
    (pr) =>
      TRUNK_BRANCHES.has(pr.baseRefName) ||
      pr.baseRefName === pr.branch ||
      !branchOwner.has(pr.baseRefName),
  );

  const forest: StackTreeNode[] = [];
  for (const root of roots) {
    if (!visited.has(root.number)) {
      forest.push(buildNode(root, 0));
    }
  }

  for (const pr of pullRequests) {
    if (!visited.has(pr.number)) {
      forest.push(buildNode(pr, 0));
    }
  }

  return forest;
}

function formatAge(ageHours: number): string {
  if (!Number.isFinite(ageHours) || ageHours < 0) {
    return "0h";
  }
  if (ageHours < 1) {
    return `${String(Math.max(1, Math.round(ageHours * 60)))}m`;
  }
  return ageHours < 48
    ? `${String(Math.round(ageHours))}h`
    : `${(ageHours / 24).toFixed(1)}d`;
}

function checkPill(checks: StackCheckState): PillSpec {
  switch (checks) {
    case "SUCCESS":
    case "passing":
      return { key: "checks", text: "Checks OK", tone: "ok" };
    case "FAILURE":
    case "ERROR":
    case "failing":
      return {
        key: "checks",

        text: "Checks failing",
        tone: "error",
      };
    case "PENDING":
    case "EXPECTED":
    case "pending":
      return {
        key: "checks",

        text: "Checks pending",
        tone: "warning",
      };
    case "NONE":
    case "none":
      return { key: "checks", text: "No checks", tone: "neutral" };
  }
}

function reviewPill(
  decision: StackReviewDecision | undefined,
  exactHeadApproved: boolean | undefined,
): PillSpec | null {
  const normalized = decision?.toUpperCase();
  if (normalized === "CHANGES_REQUESTED") {
    return {
      key: "review",

      text: "Changes requested",
      tone: "error",
    };
  }
  if (exactHeadApproved === false && normalized === "APPROVED") {
    return {
      key: "review",

      text: "Stale approval",
      tone: "warning",
    };
  }
  if (exactHeadApproved === true || normalized === "APPROVED") {
    return { key: "review", text: "Approved", tone: "ok" };
  }
  return normalized === "REVIEW_REQUIRED"
    ? { key: "review", text: "Review needed", tone: "info" }
    : null;
}

function pillsForPr(pr: StackPullRequest): PillSpec[] {
  const pills: PillSpec[] = [];
  if (pr.draft) {
    pills.push({ key: "draft", text: "Draft", tone: "neutral" });
  }
  pills.push(checkPill(pr.checks));
  const review = reviewPill(pr.reviewDecision, pr.exactHeadApproved);
  if (review !== null) {
    pills.push(review);
  }
  if (pr.mergeable?.toUpperCase() === "CONFLICTING") {
    pills.push({
      key: "conflict",

      text: "Conflict",
      tone: "error",
    });
  }
  return pills;
}

function flatten(forest: readonly StackTreeNode[]): StackTreeNode[] {
  return forest.flatMap((node) => [node, ...flatten(node.children)]);
}

function StackRow({
  node,
}: {
  readonly node: StackTreeNode;
}): React.JSX.Element {
  const { pr, depth } = node;
  const pills = pillsForPr(pr);
  const showBase = depth === 0 && !TRUNK_BRANCHES.has(pr.baseRefName);

  return (
    <tr data-stack-depth={depth}>
      <th scope="row">
        <span
          className="visual-stack-head"
          style={{ paddingInlineStart: `${String(Math.min(depth, 4) * 18)}px` }}
        >
          {depth > 0 ? (
            <span className="visual-stack-connector" aria-hidden="true">
              └─
            </span>
          ) : null}
          <a
            className="visual-stack-number"
            href={pr.url}
            target="_blank"
            rel="noreferrer"
          >
            {`#${String(pr.number)}`}
          </a>
          <a
            className="visual-stack-title"
            href={pr.url}
            target="_blank"
            rel="noreferrer"
          >
            {pr.title}
          </a>
        </span>
      </th>
      <td>
        <span className="visual-stack-status">
          {pills.map((pill) => (
            <StatusGlyph
              key={pill.key}
              severity={pillSeverity(pill.tone) ?? "unknown"}
              label={pill.text}
            />
          ))}
        </span>
      </td>
      <td>
        <code className="visual-stack-branch">
          <Identifier
            value={showBase ? `${pr.branch} → ${pr.baseRefName}` : pr.branch}
          />
        </code>
      </td>
      <td className="visual-stack-author">
        {pr.authorLogin !== undefined &&
        pr.authorLogin !== null &&
        pr.authorLogin.length > 0
          ? `@${pr.authorLogin}`
          : null}
      </td>
      <td className="num">{formatAge(pr.ageHours)}</td>
    </tr>
  );
}

/**
 * Stacked PR hierarchy rooted at `main` or standalone base branches, as one
 * table: each stacked PR is a child row under the PR it builds on.
 */
export function StackTree({
  pullRequests,
  label = "Pull request stacks",
  emptyMessage = "No open pull requests.",
}: StackTreeProps): React.JSX.Element {
  const forest = buildStackForest(pullRequests);
  if (forest.length === 0) {
    return <p className="visual-empty">{emptyMessage}</p>;
  }
  return (
    <div className="ui-table-scroll visual-stack-tree">
      <table className="ui-table visual-stack-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Pull request</th>
            <th scope="col">Status</th>
            <th scope="col">Branch</th>
            <th scope="col">Author</th>
            <th scope="col" className="num">
              Age
            </th>
          </tr>
        </thead>
        <tbody>
          {flatten(forest).map((node) => (
            <StackRow key={node.pr.number} node={node} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
