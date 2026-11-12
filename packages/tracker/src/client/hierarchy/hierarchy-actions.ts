import { useState, useSyncExternalStore } from "react";
import { api, queryClient, type IssueDetailData } from "#client/data/api.ts";
import {
  cachedIssue,
  issueKey,
  listsKey,
  patchDetail,
  type IssueListData,
} from "#client/data/cache.ts";
import { currentActor } from "#client/data/identity.ts";
import {
  createIssue,
  editIssue,
  loadedIssue,
  workspace,
} from "#client/data/mutations.ts";
import { applyChange } from "#client/controls/issue-actions.ts";
import { teamStates } from "#client/controls/property-options.tsx";
import type { IssuePrefill } from "#client/issues/issue-form.tsx";
import { notifyError } from "#client/ui/toast.tsx";

/** A value that screens far apart publish and one host answers. */
function requestStore<T>() {
  let value: T | undefined;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    set(next: T | undefined) {
      value = next;
      for (const listener of listeners) {
        listener();
      }
    },
    get: () => value,
    use: () => useSyncExternalStore(subscribe, () => value),
  };
}

/** The issues whose parent the "Set parent" dialog is choosing. */
export const parentRequest = requestStore<readonly string[]>();

export function requestParent(identifiers: readonly string[]) {
  parentRequest.set(identifiers.length === 0 ? undefined : identifiers);
}

export function removeParent(identifiers: readonly string[]) {
  applyChange(identifiers, { kind: "parent", parentIdentifier: null });
}

/** New issue requests from places that do not hold the shell, e.g. a menu. */
export const createRequest = requestStore<{
  id: number;
  prefill: IssuePrefill;
}>();
let createCount = 0;

/** Answer New issue requests in the shell that owns the dialog. */
export function useCreateRequests(create: (prefill: IssuePrefill) => void) {
  const requested = createRequest.use();
  const [answered, setAnswered] = useState(0);
  if (requested !== undefined && requested.id !== answered) {
    setAnswered(requested.id);
    create(requested.prefill);
  }
}

/** Open New issue as a sub-issue of this one: same team and project. */
export function requestSubIssue(identifier: string) {
  const parent = loadedIssue(identifier);
  createCount += 1;
  createRequest.set({
    id: createCount,
    prefill: {
      teamKey: parent.team.key,
      parentIdentifier: identifier,
      ...(parent.project === null ? {} : { projectSlug: parent.project.slug }),
    },
  });
}

/**
 * The issue and the ancestors the cache knows: none of them may become a
 * sub-issue of it. The server rejects a cycle the cache could not see.
 */
export function ancestorsOf(identifier: string) {
  const seen = [identifier];
  let parent = cachedIssue(queryClient, identifier)?.parent?.identifier;
  while (parent !== undefined && !seen.includes(parent)) {
    seen.push(parent);
    parent = cachedIssue(queryClient, parent)?.parent?.identifier;
  }
  return seen;
}

/**
 * Issues that cannot become the parent of these: the issues themselves and
 * the sub-issues their cached details list. The server rejects deeper cycles.
 */
export function cannotParent(identifiers: readonly string[]) {
  return identifiers.flatMap((identifier) => [
    identifier,
    ...(queryClient
      .getQueryData<IssueDetailData>(issueKey(identifier))
      ?.children.map((child) => child.identifier) ?? []),
  ]);
}

/** Load an issue the screen only names, so it can be edited optimistically. */
export async function ensureIssue(identifier: string) {
  if (cachedIssue(queryClient, identifier) === undefined) {
    await queryClient.query({
      queryKey: issueKey(identifier),
      queryFn: () =>
        api.issues.byIdentifier.query({
          identifier,
          viewerActorKey: currentActor().key,
        }),
    });
  }
}

/** Put an issue that already exists under `parent`. */
export async function adoptIssue(parent: string, child: string) {
  try {
    await ensureIssue(child);
  } catch (error) {
    notifyError(
      `${child}: ${error instanceof Error ? error.message : "not found"}`,
    );
    return;
  }
  await editIssue(child, { kind: "parent", parentIdentifier: parent });
}

type Child = IssueDetailData["children"][number];

function setChildren(parent: string, change: (children: Child[]) => Child[]) {
  const detail = queryClient.getQueryData<IssueDetailData>(issueKey(parent));
  if (detail === undefined) {
    return;
  }
  const children = change(detail.children);
  const counts = {
    childCount: children.length,
    completedChildCount: children.filter(
      ({ state }) => state.type === "completed",
    ).length,
  };
  patchDetail(queryClient, parent, (known) => ({
    ...known,
    children,
    ...counts,
  }));
  queryClient.setQueriesData<IssueListData>({ queryKey: listsKey }, (data) =>
    data === undefined
      ? data
      : {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((row) =>
              row.identifier === parent ? { ...row, ...counts } : row,
            ),
          })),
        },
  );
}

/**
 * Create a sub-issue from its title alone. It joins the parent's list at
 * once, in the team's triage state; the server's identifier replaces the
 * placeholder, and a failure takes it out again and says why.
 */
export async function createSubIssue(
  parent: IssueDetailData,
  title: string,
): Promise<string | undefined> {
  const states = teamStates(workspace(), parent.teamId);
  const state = states.find(({ type }) => type === "triage") ?? states[0];
  if (state === undefined) {
    throw new Error(`Team ${parent.team.key} has no states`);
  }
  const placeholder: Child = {
    identifier: `optimistic-${crypto.randomUUID()}`,
    title,
    state,
    priority: 0,
    assignee: null,
  };
  setChildren(parent.identifier, (children) => [...children, placeholder]);
  try {
    const issue = await createIssue({
      teamKey: parent.team.key,
      title,
      stateName: state.name,
      parentIdentifier: parent.identifier,
      ...(parent.project === null ? {} : { projectSlug: parent.project.slug }),
    });
    setChildren(parent.identifier, (children) =>
      children.map((child) =>
        child.identifier === placeholder.identifier
          ? {
              identifier: issue.identifier,
              title: issue.title,
              state: issue.state,
              priority: issue.priority,
              assignee: issue.assignee,
            }
          : child,
      ),
    );
    return issue.identifier;
  } catch (error) {
    setChildren(parent.identifier, (children) =>
      children.filter(
        ({ identifier }) => identifier !== placeholder.identifier,
      ),
    );
    notifyError(
      `Sub-issue not created: ${error instanceof Error ? error.message : "something went wrong"}`,
    );
    return undefined;
  }
}
