import { api, queryClient, type IssueDetailData } from "./api.ts";
import {
  cachedIssue,
  invalidateIssue,
  optimistic,
  patchDetail,
  type Outcome,
} from "./cache.ts";
import { currentActor } from "./identity.ts";
import { loadedIssue, noteActor, workspace } from "./mutations.ts";
import {
  dismissToast,
  notify,
  notifyError,
  notifyUndo,
} from "#client/ui/toast.tsx";

type Comment = IssueDetailData["comments"][number];
type Relation = IssueDetailData["relations"][number];
export type RelationType = "related" | "blocks" | "blocked-by" | "duplicate";

const reason = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong";

/** Report a failed mutation; its optimistic change is already taken back. */
function reported<T>(outcome: Outcome<T>, what: string) {
  if (outcome.ok) {
    noteActor();
  } else {
    notifyError(`${what}: ${reason(outcome.error)}`);
  }
  return outcome;
}

function withComments(
  identifier: string,
  change: (comments: Comment[]) => Comment[],
) {
  patchDetail(queryClient, identifier, (detail) => ({
    ...detail,
    comments: change(detail.comments),
  }));
}

/** Put `item` back where it was unless a refetch already restored it. */
function reinsert<T extends { id: string }>(
  items: T[],
  item: T,
  index: number,
) {
  return items.some(({ id }) => id === item.id)
    ? items
    : [...items.slice(0, index), item, ...items.slice(index)];
}

/** The signed-in actor as a comment author, before the server has said so. */
function author(): Comment["author"] {
  const actor = currentActor();
  const now = new Date().toISOString();
  return (
    workspace().actors.find(({ key }) => key === actor.key) ?? {
      id: `optimistic-${actor.key}`,
      key: actor.key,
      kind: actor.kind,
      name: actor.name,
      firstSeenAt: now,
      lastSeenAt: now,
      seenCount: 0,
      firstMetadata: actor.metadata,
      metadata: actor.metadata,
    }
  );
}

/** Post a comment; it joins the timeline at once. */
export async function addComment(
  identifier: string,
  body: string,
  attachmentIds: string[],
) {
  const writer = author();
  const draft: Comment = {
    id: `optimistic-${crypto.randomUUID()}`,
    issueId: loadedIssue(identifier).id,
    authorId: writer.id,
    author: writer,
    body,
    createdAt: new Date().toISOString(),
    editedAt: null,
  };
  const outcome = await optimistic({
    apply: () => {
      withComments(identifier, (comments) => [...comments, draft]);
      return () => {
        withComments(identifier, (comments) =>
          comments.filter(({ id }) => id !== draft.id),
        );
      };
    },
    run: async () => {
      const saved = await api.comments.create.mutate({
        actor: currentActor(),
        identifier,
        body,
        attachmentIds,
      });
      withComments(identifier, (comments) =>
        comments.map((comment) =>
          comment.id === draft.id ? { ...comment, ...saved } : comment,
        ),
      );
    },
    settle: () => {
      invalidateIssue(queryClient, identifier);
    },
  });
  if (outcome.ok) {
    notify("Comment added");
  }
  return reported(outcome, "Comment not posted");
}

export async function editComment(
  identifier: string,
  comment: Comment,
  body: string,
) {
  const outcome = await optimistic({
    apply: () => {
      withComments(identifier, (comments) =>
        comments.map((item) =>
          item.id === comment.id
            ? { ...item, body, editedAt: new Date().toISOString() }
            : item,
        ),
      );
      return () => {
        withComments(identifier, (comments) =>
          comments.map((item) =>
            item.id === comment.id
              ? { ...item, body: comment.body, editedAt: comment.editedAt }
              : item,
          ),
        );
      };
    },
    run: () =>
      api.comments.update.mutate({
        actor: currentActor(),
        id: comment.id,
        body,
      }),
    settle: () => {
      invalidateIssue(queryClient, identifier);
    },
  });
  if (outcome.ok) {
    notify("Comment updated");
  }
  return reported(outcome, "Comment not saved");
}

export async function deleteComment(identifier: string, comment: Comment) {
  const outcome = await optimistic({
    apply: () => {
      const index =
        queryClient
          .getQueryData<IssueDetailData>(["issue", identifier])
          ?.comments.findIndex(({ id }) => id === comment.id) ?? 0;
      withComments(identifier, (comments) =>
        comments.filter(({ id }) => id !== comment.id),
      );
      return () => {
        withComments(identifier, (comments) =>
          reinsert(comments, comment, index),
        );
      };
    },
    run: () =>
      api.comments.delete.mutate({ actor: currentActor(), id: comment.id }),
    settle: () => {
      invalidateIssue(queryClient, identifier);
    },
  });
  if (outcome.ok) {
    notify("Comment deleted");
  }
  return reported(outcome, "Comment not deleted");
}

function withRelations(
  identifier: string,
  change: (relations: Relation[]) => Relation[],
) {
  patchDetail(queryClient, identifier, (detail) => ({
    ...detail,
    relations: change(detail.relations),
  }));
}

function nothingToUndo() {
  // The relation was not shown early, so a failure has nothing to take back.
}

/** Both issues list a relation, so both details change together. */
function relationEnds(relation: Relation) {
  return [relation.from.identifier, relation.to.identifier];
}

/** The relation as the server will store it, when both issues are cached. */
function draftRelation(
  identifier: string,
  target: string,
  type: RelationType,
): Relation | undefined {
  const first = cachedIssue(queryClient, identifier);
  const second = cachedIssue(queryClient, target);
  if (first === undefined || second === undefined) {
    return undefined;
  }
  const swap =
    type === "blocked-by" || (type === "related" && first.id > second.id);
  const [from, to] = swap ? [second, first] : [first, second];
  return {
    id: `optimistic-${crypto.randomUUID()}`,
    fromId: from.id,
    toId: to.id,
    type: type === "blocked-by" ? "blocks" : type,
    from,
    to,
  };
}

/**
 * Relate two issues. The relation shows at once when the other issue is
 * already cached; otherwise it appears when the server answers.
 */
export async function addRelation(
  identifier: string,
  target: string,
  type: RelationType,
) {
  const draft = draftRelation(identifier, target, type);
  const outcome = await optimistic({
    apply: () => {
      if (draft === undefined) {
        return nothingToUndo;
      }
      for (const end of relationEnds(draft)) {
        withRelations(end, (relations) => [...relations, draft]);
      }
      return () => {
        for (const end of relationEnds(draft)) {
          withRelations(end, (relations) =>
            relations.filter(({ id }) => id !== draft.id),
          );
        }
      };
    },
    run: () =>
      api.relations.create.mutate({
        actor: currentActor(),
        identifier,
        target,
        type,
      }),
    settle: () => {
      invalidateIssue(queryClient, identifier);
      void queryClient.invalidateQueries({ queryKey: ["issue", target] });
    },
  });
  if (outcome.ok) {
    notify("Relation added");
  }
  return reported(outcome, "Relation not added");
}

/** Remove a relation; Undo creates it again. */
export async function removeRelation(relation: Relation) {
  const [from, to] = [relation.from.identifier, relation.to.identifier];
  const toast = notifyUndo(`Relation between ${from} and ${to} removed`, {
    undo: () => {
      void addRelation(from, to, relation.type);
    },
  });
  const outcome = await optimistic({
    apply: () => {
      const restore = relationEnds(relation).map((end) => {
        const index =
          queryClient
            .getQueryData<IssueDetailData>(["issue", end])
            ?.relations.findIndex(({ id }) => id === relation.id) ?? 0;
        withRelations(end, (relations) =>
          relations.filter(({ id }) => id !== relation.id),
        );
        return () => {
          withRelations(end, (relations) =>
            reinsert(relations, relation, index),
          );
        };
      });
      return () => {
        for (const undo of restore) {
          undo();
        }
      };
    },
    run: () =>
      api.relations.delete.mutate({ actor: currentActor(), id: relation.id }),
    settle: () => {
      for (const end of relationEnds(relation)) {
        void queryClient.invalidateQueries({ queryKey: ["issue", end] });
        void queryClient.invalidateQueries({ queryKey: ["events", end] });
      }
    },
  });
  if (!outcome.ok) {
    dismissToast(toast);
  }
  return reported(outcome, "Relation not removed");
}
