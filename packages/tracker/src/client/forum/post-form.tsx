import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ForumKind } from "#shared/forum.ts";
import { IdentifierSchema } from "#shared/schema.ts";
import { api } from "#client/data/api.ts";
import { currentActor, useCurrentActor } from "#client/data/identity.ts";
import { useDraft } from "#client/data/use-draft.ts";
import { useShell } from "#client/shell/shell-context.ts";
import { MarkdownEditor } from "#client/ui/markdown.tsx";
import { ErrorNotice } from "#client/ui/ui.tsx";
import {
  fromLocalDateTimeValue,
  toLocalDateTimeValue,
  useRefreshForum,
  type Post,
} from "./data.ts";
import {
  KindAndProjectSelects,
  LinkedIssuesField,
  NoticeFields,
} from "./post-form-fields.tsx";

export type PostFormPrefill = {
  kind?: ForumKind;
  issueIdentifier?: string;
  projectSlug?: string;
};

type InitialFormValues = {
  kind: ForumKind;
  title: string;
  scopes: string;
  projectSlug: string;
  condition: string;
  ownerKey: string;
  localExpires: string;
  linkedIssues: string[];
  draftKey: string;
  baselineBody: string;
  subject: string;
};

function parseIssueTokens(
  chips: readonly string[],
  rawInput: string,
): string[] {
  const combined = [
    ...chips,
    ...rawInput
      .split(",")
      .map((part) => part.trim().toUpperCase())
      .filter((part) => IdentifierSchema.safeParse(part).success),
  ];
  return [...new Set(combined)];
}

function buildPostFields(input: {
  kind: ForumKind;
  title: string;
  body: string;
  scopes: string;
  projectSlug: string;
  condition: string;
  localExpires: string;
  ownerKey: string;
  attachmentIds: string[];
}) {
  const parsedScopes = input.scopes
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  const isNotice = input.kind === "notice";
  return {
    title: input.title,
    body: input.body,
    scopes: parsedScopes,
    projectSlug: input.projectSlug === "" ? null : input.projectSlug,
    exitCondition: isNotice ? input.condition : null,
    expiresAt: isNotice ? fromLocalDateTimeValue(input.localExpires) : null,
    ownerKey: isNotice ? (input.ownerKey === "" ? null : input.ownerKey) : null,
    attachmentIds: input.attachmentIds,
  };
}

function valuesFromPost(post: Post): InitialFormValues {
  return {
    kind: post.kind,
    title: post.title,
    scopes: post.scopes.join(", "),
    projectSlug: post.project?.slug ?? "",
    condition: post.exitCondition ?? "",
    ownerKey: post.owner?.key ?? "",
    localExpires: toLocalDateTimeValue(post.expiresAt),
    linkedIssues: [],
    draftKey: `forum:edit:${post.id}`,
    baselineBody: post.body,
    subject: post.id,
  };
}

function valuesFromPrefill(
  prefill: PostFormPrefill | undefined,
): InitialFormValues {
  const prefillIssue = prefill?.issueIdentifier?.trim().toUpperCase() ?? "";
  return {
    kind: prefill?.kind ?? "notice",
    title: "",
    scopes: "",
    projectSlug: prefill?.projectSlug ?? "",
    condition: "",
    ownerKey: "",
    localExpires: "",
    linkedIssues: prefillIssue === "" ? [] : [prefillIssue],
    draftKey: "forum:new-post",
    baselineBody: "",
    subject: "new",
  };
}

export function PostForm({
  post,
  prefill,
  close,
  created,
}: {
  post?: Post;
  prefill?: PostFormPrefill;
  close: () => void;
  created?: (createdPost: Post) => void;
}) {
  const baseId = useId();
  const { bootstrap } = useShell();
  const actor = useCurrentActor();
  const refresh = useRefreshForum();
  const initial =
    post === undefined ? valuesFromPrefill(prefill) : valuesFromPost(post);

  const [kind, setKind] = useState<ForumKind>(initial.kind);
  const [title, setTitle] = useState(initial.title);
  const [scopes, setScopes] = useState(initial.scopes);
  const [projectSlug, setProjectSlug] = useState(initial.projectSlug);
  const [condition, setCondition] = useState(initial.condition);
  const [ownerKey, setOwnerKey] = useState(initial.ownerKey);
  const [localExpires, setLocalExpires] = useState(initial.localExpires);
  const [linkedIssues, setLinkedIssues] = useState<string[]>(
    initial.linkedIssues,
  );
  const [issueInput, setIssueInput] = useState("");
  const [revision, setRevision] = useState(post?.revision);

  const bodyDraft = useDraft(initial.draftKey, initial.baselineBody, {
    kind: "forum-post",
    subject: initial.subject,
    saved: () => false,
    recheck: () => refresh(),
  });

  const knownScopes = useQuery({
    queryKey: ["forum", "scopes"],
    queryFn: () => api.forum.scopes.query(),
    enabled: bootstrap.forumEnabled,
  });

  const save = useMutation({
    mutationFn: () => {
      const common = buildPostFields({
        kind,
        title,
        body: bodyDraft.text,
        scopes,
        projectSlug,
        condition,
        localExpires,
        ownerKey,
        attachmentIds: bodyDraft.attachments,
      });
      return post === undefined || revision === undefined
        ? api.forum.create.mutate({
            actor: currentActor(),
            kind,
            ...common,
            linkedIssueIdentifiers: parseIssueTokens(linkedIssues, issueInput),
          })
        : api.forum.update.mutate({
            actor: currentActor(),
            id: post.id,
            expectedRevision: revision,
            ...common,
          });
    },
    onSuccess: async (saved) => {
      bodyDraft.reset();
      await refresh();
      created?.(saved);
      close();
    },
    onError: () => {
      void refresh();
    },
  });

  const isCreate = post === undefined;

  return (
    <form
      className="forum-form"
      aria-label={isCreate ? "New forum post" : "Edit forum post"}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <fieldset disabled={save.isPending}>
        <legend className="sr-only">Post details</legend>
        <KindAndProjectSelects
          baseId={baseId}
          isCreate={isCreate}
          kind={kind}
          setKind={setKind}
          projectSlug={projectSlug}
          setProjectSlug={setProjectSlug}
          projects={bootstrap.projects}
        />
        <label htmlFor={`${baseId}-title`}>
          Title
          <input
            id={`${baseId}-title`}
            required
            maxLength={500}
            value={title}
            placeholder="Concise summary of the thread"
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
        </label>
        <div className="forum-field-block">
          <label htmlFor={`${baseId}-body`}>Body</label>
          <MarkdownEditor
            id={`${baseId}-body`}
            label="Body"
            required
            placeholder="Share context, findings, or decisions…"
            value={bodyDraft.text}
            onChange={bodyDraft.setText}
            onAttachments={bodyDraft.addAttachments}
          />
        </div>
        <label htmlFor={`${baseId}-scopes`}>
          Scopes
          <input
            id={`${baseId}-scopes`}
            list={`${baseId}-scopes-list`}
            value={scopes}
            placeholder="main, ci, cluster"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => {
              setScopes(event.target.value);
            }}
          />
          <datalist id={`${baseId}-scopes-list`}>
            {knownScopes.data?.map((item) => (
              <option key={item.scope} value={item.scope} />
            ))}
          </datalist>
          <span className="muted">
            Comma-separated tags. Leave empty to apply globally.
          </span>
        </label>
        {isCreate && (
          <LinkedIssuesField
            baseId={baseId}
            linkedIssues={linkedIssues}
            setLinkedIssues={setLinkedIssues}
            issueInput={issueInput}
            setIssueInput={setIssueInput}
          />
        )}
        {kind === "notice" && (
          <NoticeFields
            baseId={baseId}
            actor={actor}
            actors={bootstrap.actors}
            condition={condition}
            setCondition={setCondition}
            ownerKey={ownerKey}
            setOwnerKey={setOwnerKey}
            localExpires={localExpires}
            setLocalExpires={setLocalExpires}
          />
        )}
        <div className="forum-actions">
          <button className="primary" type="submit">
            {save.isPending ? "Saving…" : "Save post"}
          </button>
          <button type="button" onClick={close}>
            Cancel
          </button>
        </div>
      </fieldset>
      {save.error !== null && <ErrorNotice error={save.error} />}
      {save.error !== null && post !== undefined && (
        <button
          type="button"
          onClick={() => {
            setRevision(post.revision);
            save.reset();
          }}
        >
          Use latest revision after reviewing changes
        </button>
      )}
    </form>
  );
}
