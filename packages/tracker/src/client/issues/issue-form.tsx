import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { resolveIssuePriority } from "#domain/issue.ts";
import type { Effort, Impact, Urgency } from "#shared/schema.ts";
import { DuePickerHost } from "#client/due/due-picker.tsx";
import { api, queryClient, type BootstrapData } from "#client/data/api.ts";
import { drafts } from "#client/data/drafts.ts";
import { useCurrentActor } from "#client/data/identity.ts";
import { issueWasCreated, type Pending } from "#client/data/pending-drafts.ts";
import { useDraft } from "#client/data/use-draft.ts";
import { createIssue } from "#client/data/mutations.ts";
import { teamStates } from "#client/controls/property-options.tsx";
import {
  openSearchPicker,
  SearchPickerHost,
} from "#client/controls/search-picker.tsx";
import type { SearchPickerKind } from "#client/controls/picker-items.tsx";
import { ErrorNotice, Modal } from "#client/ui/ui.tsx";
import { MarkdownEditor } from "#client/ui/markdown.tsx";
import {
  chosenValues,
  FormChips,
  FormSelects,
  withChoice,
  type Choices,
  type SizingPatch,
} from "./issue-form-fields.tsx";

/** Fields a new issue starts with, taken from the view it is created in. */
export type IssuePrefill = {
  teamKey?: string;
  stateName?: string;
  priority?: number;
  urgency?: Urgency;
  impact?: Impact;
  effort?: Effort;
  projectSlug?: string;
  labels?: readonly string[];
  assigneeKey?: string;
  /** Create it as a sub-issue of this issue, in the same team. */
  parentIdentifier?: string;
  dueDate?: string;
};

function startingChoices(prefill: IssuePrefill): Choices {
  const urgency = prefill.urgency ?? null;
  const impact = prefill.impact ?? null;
  const resolved = resolveIssuePriority(
    { priority: 0, priorityManual: false, impact, urgency, voteCount: 0 },
    prefill.priority === undefined ? {} : { priority: prefill.priority },
  );
  return {
    stateName: prefill.stateName,
    ...resolved,
    urgency,
    impact,
    effort: prefill.effort ?? null,
    projectSlug: prefill.projectSlug ?? null,
    labels: prefill.labels ?? [],
    assigneeKey: prefill.assigneeKey ?? null,
    parentIdentifier: prefill.parentIdentifier ?? null,
    dueDate: prefill.dueDate ?? null,
  };
}

const titleKey = "new-issue.title";
const descriptionKey = "new-issue.description";

async function attempt(
  input: Parameters<typeof createIssue>[0],
  view: Parameters<typeof createIssue>[1],
) {
  try {
    return { ok: true, issue: await createIssue(input, view) } as const;
  } catch (error) {
    return { ok: false, error } as const;
  }
}

function useNewIssueDrafts(currentTeamKey: string) {
  const [unanswered] = useState(
    () =>
      drafts.pending(titleKey) !== undefined ||
      drafts.pending(descriptionKey) !== undefined,
  );
  const actorKey = useCurrentActor().key;
  const recentKey = ["recent-created", actorKey];
  const recent = useQuery({
    queryKey: recentKey,
    queryFn: () =>
      api.issues.list.query({
        creatorKey: actorKey,
        includeArchived: true,
        sort: "created",
        limit: 20,
      }),
    enabled: unanswered,
    staleTime: Infinity,
  });
  const issues = recent.data?.items;
  const created =
    issues === undefined
      ? undefined
      : (pending: Pending) => issueWasCreated(pending, { actorKey, issues });
  const recheck = () => queryClient.invalidateQueries({ queryKey: recentKey });
  const title = useDraft(titleKey, "", {
    kind: "new-issue-title",
    subject: currentTeamKey,
    saved: created,
    recheck,
    notice: "Restored your unsent issue",
  });
  const description = useDraft(descriptionKey, "", {
    kind: "new-issue-description",
    subject: title.text,
    saved: created,
    recheck,
  });
  return { title, description };
}

function buildCreateInput(params: {
  teamKey: string;
  stateName: string | undefined;
  choices: Choices;
  sentTitle: { text: string };
  sentDescription: { text: string; attachments: string[] };
}): Parameters<typeof createIssue>[0] {
  const { teamKey, stateName, choices, sentTitle, sentDescription } = params;
  return {
    teamKey,
    title: sentTitle.text,
    description: sentDescription.text,
    ...(stateName === undefined ? {} : { stateName }),
    ...(choices.priorityManual
      ? { priority: choices.priority, priorityManual: true }
      : {}),
    ...(choices.urgency === null ? {} : { urgency: choices.urgency }),
    ...(choices.impact === null ? {} : { impact: choices.impact }),
    ...(choices.effort === null ? {} : { effort: choices.effort }),
    ...(choices.projectSlug === null
      ? {}
      : { projectSlug: choices.projectSlug }),
    ...(choices.assigneeKey === null
      ? {}
      : { assigneeKey: choices.assigneeKey }),
    ...(choices.parentIdentifier === null
      ? {}
      : { parentIdentifier: choices.parentIdentifier }),
    ...(choices.dueDate === null ? {} : { dueDate: choices.dueDate }),
    labels: [...choices.labels],
    attachmentIds: sentDescription.attachments,
  };
}

export function NewIssue({
  open,
  close,
  bootstrap,
  teamKey: currentTeamKey,
  prefill = {},
  onCreated,
}: {
  open: boolean;
  close: () => void;
  bootstrap: BootstrapData;
  /** The team in view; a new issue starts there unless the form picks another. */
  teamKey: string;
  prefill?: IssuePrefill;
  /** Called with the new issue; `view` asks for it to be opened. */
  onCreated: (identifier: string, view: boolean) => void;
}) {
  const [chosenTeam, setTeam] = useState(prefill.teamKey);
  const { title, description } = useNewIssueDrafts(currentTeamKey);
  const [choices, setChoices] = useState(() => startingChoices(prefill));
  const choose = (change: Partial<Choices>) => {
    setChoices((known) => ({ ...known, ...change }));
  };
  const onSizing = (patch: SizingPatch) => {
    setChoices((known) => ({
      ...known,
      ...(patch.urgency === undefined ? {} : { urgency: patch.urgency }),
      ...(patch.impact === undefined ? {} : { impact: patch.impact }),
      ...resolveIssuePriority({ ...known, voteCount: 0 }, patch),
    }));
  };
  const teamKey = chosenTeam ?? currentTeamKey;
  const team = bootstrap.teams.find(({ key }) => key === teamKey);
  const states = team === undefined ? [] : teamStates(bootstrap, team.id);
  const stateName =
    choices.stateName ??
    (states.find(({ type }) => type === "triage") ?? states[0])?.name;
  const me = useCurrentActor();
  const project = bootstrap.projects.find(
    ({ slug }) => slug === choices.projectSlug,
  );
  const assigneeName =
    bootstrap.actors.find(({ key }) => key === choices.assigneeKey)?.name ??
    (choices.assigneeKey === me.key ? me.name : undefined);
  const create = useMutation({
    mutationFn: async (view: boolean) => {
      const outcome = await title.send(
        (sentTitle) =>
          description.send(
            (sentDescription) =>
              attempt(
                buildCreateInput({
                  teamKey,
                  stateName,
                  choices,
                  sentTitle,
                  sentDescription,
                }),
                view
                  ? undefined
                  : (identifier) => {
                      onCreated(identifier, true);
                    },
              ),
            description.text,
          ),
        title.text,
      );
      if (!outcome.ok) throw outcome.error;
      return outcome.issue;
    },
    onSuccess: (issue, view) => {
      title.reset();
      description.reset();
      setTeam(undefined);
      setChoices(startingChoices({}));
      close();
      onCreated(issue.identifier, view);
    },
  });
  function pick(kind: SearchPickerKind, anchor: HTMLElement) {
    if (team === undefined) return;
    openSearchPicker({
      kind,
      anchor,
      teamId: team.id,
      teamKey: team.key,
      title: `${{ assignee: "Assignee", labels: "Labels", project: "Project" }[kind]} of the new issue`,
      selected: chosenValues(kind, choices),
      pick: (value, add) => {
        setChoices((known) => withChoice(known, kind, value, add));
      },
    });
  }
  return (
    <Modal
      title="New issue"
      open={open}
      onClose={close}
      pickerScope="new-issue"
    >
      <SearchPickerHost bootstrap={bootstrap} scope="new-issue" />
      <DuePickerHost scope="new-issue" />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (event.currentTarget.reportValidity()) {
              create.mutate(event.shiftKey);
            }
          }
        }}
      >
        <FormSelects
          teams={bootstrap.teams}
          teamKey={teamKey}
          states={states}
          stateName={stateName}
          choices={choices}
          onTeam={(value) => {
            setTeam(value);
            choose({
              labels: [],
              stateName: undefined,
              parentIdentifier: null,
            });
          }}
          onSizing={onSizing}
          choose={choose}
        />
        <input
          className="title-input"
          aria-label="Issue title"
          placeholder="Issue title"
          value={title.text}
          required
          maxLength={500}
          onChange={(event) => {
            title.setText(event.target.value);
          }}
        />
        <MarkdownEditor
          value={description.text}
          onChange={description.setText}
          onAttachments={description.addAttachments}
          placeholder="Add a description…"
          label="Description"
        />
        <FormChips
          choices={choices}
          assigneeName={assigneeName}
          project={project}
          pick={pick}
          choose={choose}
        />
        {create.error !== null && <ErrorNotice error={create.error} />}
        <div className="modal-footer">
          <span className="muted">
            <kbd>⌘ Enter</kbd> create · <kbd>⌘ ⇧ Enter</kbd> create and open
          </span>
          <span className="spacer" />
          {(title.dirty || description.dirty) && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                title.reset();
                description.reset();
                create.reset();
              }}
            >
              Discard draft
            </button>
          )}
          <button
            type="submit"
            className="primary"
            disabled={create.isPending || !bootstrap.writesEnabled}
          >
            {create.isPending ? "Creating…" : "Create issue"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
