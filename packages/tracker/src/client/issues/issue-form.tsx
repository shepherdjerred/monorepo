import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  Folder,
  GitFork,
  Tag,
  UserRound,
  X,
} from "lucide-react";
import { localToday } from "#client/due/dates.ts";
import { dueLabel } from "#client/due/due-display.ts";
import {
  DuePickerHost,
  duePanel,
  openDuePicker,
} from "#client/due/due-picker.tsx";
import { api, queryClient, type BootstrapData } from "#client/data/api.ts";
import { drafts } from "#client/data/drafts.ts";
import { currentActor } from "#client/data/identity.ts";
import { issueWasCreated, type Pending } from "#client/data/pending-drafts.ts";
import { useDraft } from "#client/data/use-draft.ts";
import { createIssue } from "#client/data/mutations.ts";
import { EnumPicker } from "#client/controls/enum-picker.tsx";
import {
  priorityOptions,
  stateOptions,
  teamStates,
} from "#client/controls/property-options.tsx";
import {
  openSearchPicker,
  SearchPickerHost,
} from "#client/controls/search-picker.tsx";
import type { SearchPickerKind } from "#client/controls/picker-items.tsx";
import { ErrorNotice, Modal, Swatch } from "#client/ui/ui.tsx";
import { MarkdownEditor } from "#client/ui/markdown.tsx";

/** Fields a new issue starts with, taken from the view it is created in. */
export type IssuePrefill = {
  teamKey?: string;
  stateName?: string;
  priority?: number;
  projectSlug?: string;
  labels?: readonly string[];
  assigneeKey?: string;
  /** Create it as a sub-issue of this issue, in the same team. */
  parentIdentifier?: string;
  dueDate?: string;
};

type Choices = {
  stateName: string | undefined;
  priority: number;
  projectSlug: string | null;
  labels: readonly string[];
  assigneeKey: string | null;
  parentIdentifier: string | null;
  dueDate: string | null;
};

const startingChoices = (prefill: IssuePrefill): Choices => ({
  stateName: prefill.stateName,
  priority: prefill.priority ?? 0,
  projectSlug: prefill.projectSlug ?? null,
  labels: prefill.labels ?? [],
  assigneeKey: prefill.assigneeKey ?? null,
  parentIdentifier: prefill.parentIdentifier ?? null,
  dueDate: prefill.dueDate ?? null,
});

/** The values a searchable picker shows as chosen for this form. */
function chosenValues(kind: SearchPickerKind, choices: Choices) {
  if (kind === "labels") {
    return choices.labels;
  }
  const value = kind === "assignee" ? choices.assigneeKey : choices.projectSlug;
  return value === null ? [] : [value];
}

function withChoice(
  known: Choices,
  kind: SearchPickerKind,
  value: string | null,
  add: boolean,
): Choices {
  if (kind === "assignee") {
    return { ...known, assigneeKey: value };
  }
  if (kind === "project") {
    return { ...known, projectSlug: value };
  }
  const others = known.labels.filter((name) => name !== value);
  return {
    ...known,
    labels: add && value !== null ? [...others, value] : others,
  };
}

function PropertyButton({
  kind,
  label,
  icon,
  open,
}: {
  kind: SearchPickerKind;
  label: string;
  icon: ReactNode;
  open: (kind: SearchPickerKind, anchor: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className="property-chip"
      aria-haspopup="dialog"
      onClick={(event) => {
        open(kind, event.currentTarget);
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** The new issue's due date, and its parent when it is a sub-issue. */
function PlanningChips({
  dueDate,
  parentIdentifier,
  choose,
}: {
  dueDate: string | null;
  parentIdentifier: string | null;
  choose: (change: Partial<Choices>) => void;
}) {
  return (
    <>
      <button
        type="button"
        className="property-chip"
        aria-haspopup="dialog"
        onPointerEnter={duePanel.prefetch}
        onFocus={duePanel.prefetch}
        onClick={(event) => {
          openDuePicker({
            anchor: event.currentTarget,
            title: "Due date of the new issue",
            value: dueDate,
            pick: (day) => {
              choose({ dueDate: day });
            },
          });
        }}
      >
        <CalendarClock size={14} aria-hidden="true" />
        <span>
          {dueDate === null
            ? "Due date"
            : `Due ${dueLabel(dueDate, localToday())}`}
        </span>
      </button>
      {parentIdentifier !== null && (
        <span className="property-chip parent-chip">
          <GitFork size={14} aria-hidden="true" />
          <span>Sub-issue of {parentIdentifier}</span>
          <button
            type="button"
            className="icon-button"
            aria-label={`Do not make it a sub-issue of ${parentIdentifier}`}
            onClick={() => {
              choose({ parentIdentifier: null });
            }}
          >
            <X size={12} />
          </button>
        </span>
      )}
    </>
  );
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

/** The title and description drafts of the new-issue form. */
function useNewIssueDrafts(currentTeamKey: string) {
  // An issue sent just before the page unloaded may or may not exist. The
  // actor's newest issues say which, so it is neither offered twice nor lost.
  const [unanswered] = useState(
    () =>
      drafts.pending(titleKey) !== undefined ||
      drafts.pending(descriptionKey) !== undefined,
  );
  const actorKey = currentActor().key;
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
    // The description belongs to whichever issue carries this title.
    subject: title.text,
    saved: created,
    recheck,
  });
  return { title, description };
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
  // Closing the dialog keeps what was typed; it is there on the next open.
  const { title, description } = useNewIssueDrafts(currentTeamKey);
  const [choices, setChoices] = useState(() => startingChoices(prefill));
  const choose = (change: Partial<Choices>) => {
    setChoices((known) => ({ ...known, ...change }));
  };
  const teamKey = chosenTeam ?? currentTeamKey;
  const team = bootstrap.teams.find(({ key }) => key === teamKey);
  const states = team === undefined ? [] : teamStates(bootstrap, team.id);
  // New work lands in the team's triage state unless the form says otherwise.
  const stateName =
    choices.stateName ??
    (states.find(({ type }) => type === "triage") ?? states[0])?.name;
  const project = bootstrap.projects.find(
    ({ slug }) => slug === choices.projectSlug,
  );
  const assignee = bootstrap.actors.find(
    ({ key }) => key === choices.assigneeKey,
  );
  const create = useMutation({
    // What was typed stops being a draft while it is sent, so a reload during
    // the request cannot offer an issue that already exists a second time.
    mutationFn: async (view: boolean) => {
      const outcome = await title.send(
        (sentTitle) =>
          description.send(
            (sentDescription) =>
              attempt(
                {
                  teamKey,
                  title: sentTitle.text,
                  description: sentDescription.text,
                  ...(stateName === undefined ? {} : { stateName }),
                  priority: choices.priority,
                  ...(choices.projectSlug === null
                    ? {}
                    : { projectSlug: choices.projectSlug }),
                  ...(choices.assigneeKey === null
                    ? {}
                    : { assigneeKey: choices.assigneeKey }),
                  labels: [...choices.labels],
                  attachmentIds: sentDescription.attachments,
                  ...(choices.parentIdentifier === null
                    ? {}
                    : { parentIdentifier: choices.parentIdentifier }),
                  ...(choices.dueDate === null
                    ? {}
                    : { dueDate: choices.dueDate }),
                },
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
      if (!outcome.ok) {
        throw outcome.error;
      }
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
    if (team === undefined) {
      return;
    }
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
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(false);
        }}
        onKeyDown={(e) => {
          // ⌘ Enter creates; ⌘ Shift Enter creates and opens the issue.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (e.currentTarget.reportValidity()) {
              create.mutate(e.shiftKey);
            }
          }
        }}
      >
        <div className="form-selects">
          <label>
            Team
            <EnumPicker
              label="Team"
              value={teamKey}
              options={bootstrap.teams.map((item) => ({
                value: item.key,
                label: item.key,
              }))}
              onChange={(value) => {
                setTeam(value);
                // A parent belongs to its own team.
                choose({
                  labels: [],
                  stateName: undefined,
                  parentIdentifier: null,
                });
              }}
            />
          </label>
          <label>
            Status
            <EnumPicker
              label="Status"
              value={stateName ?? ""}
              options={stateOptions(states)}
              onChange={(value) => {
                choose({ stateName: value });
              }}
            />
          </label>
          <label>
            Priority
            <EnumPicker
              label="Priority"
              value={String(choices.priority)}
              options={priorityOptions}
              onChange={(value) => {
                choose({ priority: Number(value) });
              }}
            />
          </label>
        </div>
        <input
          className="title-input"
          aria-label="Issue title"
          placeholder="Issue title"
          value={title.text}
          required
          maxLength={500}
          onChange={(e) => {
            title.setText(e.target.value);
          }}
        />
        <MarkdownEditor
          value={description.text}
          onChange={description.setText}
          onAttachments={description.addAttachments}
          placeholder="Add a description…"
          label="Description"
        />
        <div className="property-chips">
          <PropertyButton
            kind="assignee"
            label={assignee?.name ?? "Assignee"}
            icon={<UserRound size={14} aria-hidden="true" />}
            open={pick}
          />
          <PropertyButton
            kind="project"
            label={project?.name ?? "Project"}
            icon={
              project === undefined ? (
                <Folder size={14} aria-hidden="true" />
              ) : (
                <Swatch color={project.color} />
              )
            }
            open={pick}
          />
          <PropertyButton
            kind="labels"
            label={
              choices.labels.length === 0 ? "Labels" : choices.labels.join(", ")
            }
            icon={<Tag size={14} aria-hidden="true" />}
            open={pick}
          />
          <PlanningChips
            dueDate={choices.dueDate}
            parentIdentifier={choices.parentIdentifier}
            choose={choose}
          />
        </div>
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
