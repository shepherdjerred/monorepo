import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { IdentifierSchema, TeamKeySchema } from "#shared/schema.ts";
import { IssueSearchCombobox } from "#client/controls/issue-search.tsx";
import { api, queryClient, type BootstrapData } from "#client/data/api.ts";
import { eventsKey, issueKey, listsKey } from "#client/data/cache.ts";
import { currentActor, useCurrentActor } from "#client/data/identity.ts";
import { priorities } from "#client/data/issue-changes.ts";
import { notify } from "#client/ui/toast.tsx";
import { ErrorNotice, Modal, TeamSelect } from "#client/ui/ui.tsx";
import { useRefreshForum, type PostDetail } from "./data.ts";

export function HandoffNoticeModal({
  open,
  onClose,
  post,
  bootstrap,
}: {
  open: boolean;
  onClose: () => void;
  post: PostDetail;
  bootstrap: BootstrapData;
}) {
  const me = useCurrentActor();
  const refresh = useRefreshForum();
  const [targetMode, setTargetMode] = useState<string>(post.owner?.key ?? "");
  const [customActorKey, setCustomActorKey] = useState("");
  const [note, setNote] = useState("");

  const knownActors = bootstrap.actors.some((actor) => actor.key === me.key)
    ? bootstrap.actors
    : [me, ...bootstrap.actors];

  const handoff = useMutation({
    mutationFn: () => {
      const toActorKey =
        targetMode === "__custom__"
          ? customActorKey.trim() || null
          : targetMode === ""
            ? null
            : targetMode;
      return api.forum.handoff.mutate({
        actor: currentActor(),
        id: post.id,
        toActorKey,
        ...(note.trim() === "" ? {} : { note: note.trim() }),
      });
    },
    onSuccess: async (updated) => {
      await refresh();
      notify(
        updated.owner === null
          ? `Cleared owner on ${updated.identifier}`
          : `Handed off ${updated.identifier} to ${updated.owner.name}`,
      );
      setNote("");
      onClose();
    },
  });

  return (
    <Modal title="Handoff notice" open={open} onClose={onClose}>
      <form
        className="forum-form"
        onSubmit={(event) => {
          event.preventDefault();
          handoff.mutate();
        }}
      >
        <label htmlFor="handoff-target-select">
          Target owner
          <select
            id="handoff-target-select"
            value={targetMode}
            onChange={(event) => {
              setTargetMode(event.target.value);
            }}
          >
            <option value="">Clear owner (Unclaimed)</option>
            {knownActors.map((actor) => (
              <option key={actor.key} value={actor.key}>
                {actor.name} ({actor.key})
              </option>
            ))}
            <option value="__custom__">Specific actor key…</option>
          </select>
        </label>
        {targetMode === "__custom__" && (
          <label htmlFor="handoff-custom-actor">
            Actor key
            <input
              id="handoff-custom-actor"
              required
              value={customActorKey}
              placeholder="human:jerred or codex:peer"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => {
                setCustomActorKey(event.target.value);
              }}
            />
          </label>
        )}
        <label htmlFor="handoff-note">
          Handoff note
          <textarea
            id="handoff-note"
            value={note}
            placeholder="Optional context for the next owner…"
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </label>
        {handoff.error !== null && <ErrorNotice error={handoff.error} />}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={
              handoff.isPending ||
              (targetMode === "__custom__" && customActorKey.trim() === "")
            }
          >
            {handoff.isPending ? "Saving…" : "Save handoff"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function LinkIssueModal({
  open,
  onClose,
  post,
}: {
  open: boolean;
  onClose: () => void;
  post: PostDetail;
}) {
  const [target, setTarget] = useState("");
  const refresh = useRefreshForum();
  const normalized = target.trim().toUpperCase();
  const valid = IdentifierSchema.safeParse(normalized).success;
  const link = useMutation({
    mutationFn: () =>
      api.forum.linkIssue.mutate({
        actor: currentActor(),
        id: post.id,
        issueIdentifier: normalized,
      }),
    onSuccess: async () => {
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: issueKey(normalized) }),
        queryClient.invalidateQueries({ queryKey: eventsKey(normalized) }),
      ]);
      notify(`Linked ${normalized}`);
      setTarget("");
      onClose();
    },
  });

  return (
    <Modal title="Link issue" open={open} onClose={onClose}>
      <form
        className="forum-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) {
            link.mutate();
          }
        }}
      >
        <label htmlFor="forum-link-issue-input">
          Issue
          <IssueSearchCombobox
            id="forum-link-issue-input"
            label="Issue"
            value={target}
            onValueChange={setTarget}
            exclude={post.linkedIssues.map((issue) => issue.identifier)}
            autoFocus
          />
        </label>
        {link.error !== null && <ErrorNotice error={link.error} />}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={link.isPending || !valid}
          >
            {link.isPending ? "Linking…" : "Link issue"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export type PromoteTarget = {
  replyId?: string;
  sourceBody: string;
};

function defaultPromoteDescription(
  postIdentifier: string,
  sourceBody: string,
  isReply: boolean,
): string {
  const quoted = sourceBody
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${quoted}\n\n---\nPromoted from ${postIdentifier}${isReply ? " (reply)" : ""}`;
}

export function PromoteToIssueModal({
  open,
  onClose,
  post,
  target,
  bootstrap,
}: {
  open: boolean;
  onClose: () => void;
  post: PostDetail;
  target: PromoteTarget;
  bootstrap: BootstrapData;
}) {
  const navigate = useNavigate();
  const refresh = useRefreshForum();
  const isReply = target.replyId !== undefined;
  const defaultTeam =
    bootstrap.teams.find((team) => team.key === "AI")?.key ??
    bootstrap.teams[0]?.key ??
    "AI";
  const [teamKey, setTeamKey] = useState(defaultTeam);
  const [title, setTitle] = useState(
    isReply ? `Follow up from ${post.identifier}: ${post.title}` : post.title,
  );
  const [description, setDescription] = useState(() =>
    defaultPromoteDescription(post.identifier, target.sourceBody, isReply),
  );
  const [priority, setPriority] = useState(0);
  const [projectSlug, setProjectSlug] = useState(post.project?.slug ?? "");

  const promote = useMutation({
    mutationFn: () =>
      api.forum.promoteToIssue.mutate({
        actor: currentActor(),
        id: post.id,
        ...(target.replyId === undefined ? {} : { replyId: target.replyId }),
        teamKey: TeamKeySchema.parse(teamKey),
        title: title.trim(),
        description,
        priority,
        projectSlug: projectSlug === "" ? null : projectSlug,
      }),
    onSuccess: async (result) => {
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: listsKey }),
        queryClient.invalidateQueries({
          queryKey: issueKey(result.issue.identifier),
        }),
      ]);
      notify(`Created ${result.issue.identifier}`);
      onClose();
      void navigate(`/issues/${result.issue.identifier}`);
    },
  });

  const activeProjects = bootstrap.projects.filter(
    ({ archivedAt }) => archivedAt === null,
  );

  return (
    <Modal title="Promote to issue" open={open} onClose={onClose}>
      <form
        className="forum-form"
        onSubmit={(event) => {
          event.preventDefault();
          promote.mutate();
        }}
      >
        <div className="form-selects">
          <label htmlFor="promote-team">
            Team
            <TeamSelect
              id="promote-team"
              teams={bootstrap.teams}
              value={teamKey}
              onChange={setTeamKey}
            />
          </label>
          <label htmlFor="promote-priority">
            Priority
            <select
              id="promote-priority"
              value={String(priority)}
              onChange={(event) => {
                setPriority(Number(event.target.value));
              }}
            >
              {priorities.map((label, index) => (
                <option key={label} value={String(index)}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="promote-project">
            Project
            <select
              id="promote-project"
              value={projectSlug}
              onChange={(event) => {
                setProjectSlug(event.target.value);
              }}
            >
              <option value="">No project</option>
              {activeProjects.map((project) => (
                <option key={project.id} value={project.slug}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label htmlFor="promote-title">
          Title
          <input
            id="promote-title"
            required
            maxLength={500}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
        </label>
        <label htmlFor="promote-description">
          Description
          <textarea
            id="promote-description"
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        </label>
        {promote.error !== null && <ErrorNotice error={promote.error} />}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={promote.isPending || title.trim() === ""}
          >
            {promote.isPending ? "Creating…" : "Create issue"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
