import { useState, type ReactNode } from "react";
import {
  CalendarClock,
  Folder,
  Tag,
  Trash2,
  ThumbsUp,
  UserRoundX,
} from "lucide-react";
import { computePriority, isVoteBoostedPriority } from "#domain/issue.ts";
import { ActorChip, Avatar, Swatch } from "#client/ui/ui.tsx";
import { AbsoluteTime } from "#client/ui/time.tsx";
import type { BootstrapData, IssueDetailData } from "#client/data/api.ts";
import type { IssueChange } from "#client/data/issue-changes.ts";
import { editIssue } from "#client/data/mutations.ts";
import { EnumPicker } from "#client/controls/enum-picker.tsx";
import { pickDue, pickProperty } from "#client/controls/issue-actions.ts";
import { DueDate } from "#client/due/due-chip.tsx";
import { duePanel } from "#client/due/due-picker.tsx";
import { ParentField } from "#client/hierarchy/parent-field.tsx";
import {
  effortOptions,
  impactOptions,
  parseEffort,
  parseImpact,
  parseUrgency,
  priorityOptions,
  stateOptions,
  teamStates,
  urgencyOptions,
} from "#client/controls/property-options.tsx";

type Props = {
  issue: IssueDetailData;
  bootstrap: BootstrapData;
  disabled: boolean;
  onDelete: () => void;
};

/** A property set through the searchable picker, shown as its value. */
function PickerField({
  id,
  name,
  disabled,
  open,
  children,
  prefetch,
}: {
  id: string;
  name: string;
  disabled: boolean;
  open: (anchor: HTMLElement) => void;
  /** Fetch what opening needs as the pointer or focus arrives. */
  prefetch?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="property-field">
      <span className="property-name" id={`${id}-name`}>
        {name}
      </span>
      <button
        type="button"
        id={id}
        className="property-value"
        aria-haspopup="dialog"
        aria-labelledby={`${id}-name ${id}`}
        disabled={disabled}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        onClick={(event) => {
          open(event.currentTarget);
        }}
      >
        {children}
      </button>
    </div>
  );
}

/**
 * Votes count up or down the way they moved; casting one pops the thumb.
 * Only a change animates, never the first render.
 */
function VoteButton({
  issue,
  disabled,
  toggle,
}: {
  issue: IssueDetailData;
  disabled: boolean;
  toggle: () => void;
}) {
  const [seen, setSeen] = useState(issue.voteCount);
  const [tick, setTick] = useState<"up" | "down">();
  if (issue.voteCount !== seen) {
    setTick(issue.voteCount > seen ? "up" : "down");
    setSeen(issue.voteCount);
  }
  return (
    <button
      id="issue-vote"
      className={`vote-button ${issue.viewerVoted ? "voted" : ""}`}
      aria-pressed={issue.viewerVoted}
      data-tick={tick}
      disabled={disabled}
      onClick={toggle}
    >
      <ThumbsUp size={15} key={issue.voteCount} />
      <span className="vote-count" data-tick={tick}>
        <span key={issue.voteCount}>{issue.voteCount}</span>
      </span>{" "}
      {issue.voteCount === 1 ? "vote" : "votes"}
    </button>
  );
}

function PriorityModeIndicator({
  issue,
  disabled,
  update,
}: {
  issue: IssueDetailData;
  disabled: boolean;
  update: (change: Exclude<IssueChange, { kind: "move" }>) => void;
}) {
  const input = {
    impact: issue.impact,
    urgency: issue.urgency,
    voteCount: issue.voteCount,
  };
  if (issue.priorityManual) {
    return (
      <button
        type="button"
        id="property-priority-auto"
        className="priority-mode-reset"
        disabled={disabled}
        onClick={() => {
          update({ kind: "priorityAuto" });
        }}
      >
        Pinned · Auto
      </button>
    );
  }
  if (computePriority(input) === 0) return null;
  const voteBoosted = isVoteBoostedPriority(input);
  return (
    <span
      className="priority-mode"
      data-mode="auto"
      data-vote-boosted={voteBoosted ? "" : undefined}
      title={
        voteBoosted
          ? `Boosted by ${String(issue.voteCount)} votes`
          : "Derived from impact and urgency"
      }
    >
      {voteBoosted ? "Auto · +votes" : "Auto"}
    </span>
  );
}

function SizingFields({
  issue,
  disabled,
  update,
}: {
  issue: IssueDetailData;
  disabled: boolean;
  update: (change: Exclude<IssueChange, { kind: "move" }>) => void;
}) {
  return (
    <>
      <div className="property-field">
        <div className="property-header">
          <label className="property-name" htmlFor="property-priority">
            Priority
          </label>
          <PriorityModeIndicator
            issue={issue}
            disabled={disabled}
            update={update}
          />
        </div>
        <EnumPicker
          id="property-priority"
          label="Priority"
          disabled={disabled}
          value={String(issue.priority)}
          options={priorityOptions}
          onChange={(priority) => {
            update({ kind: "priority", priority: Number(priority) });
          }}
        />
      </div>
      <label>
        Urgency
        <EnumPicker
          id="property-urgency"
          label="Urgency"
          disabled={disabled}
          value={issue.urgency ?? ""}
          options={urgencyOptions}
          onChange={(value) => {
            update({ kind: "urgency", urgency: parseUrgency(value) });
          }}
        />
      </label>
      <label>
        Impact
        <EnumPicker
          id="property-impact"
          label="Impact"
          disabled={disabled}
          value={issue.impact ?? ""}
          options={impactOptions}
          onChange={(value) => {
            update({ kind: "impact", impact: parseImpact(value) });
          }}
        />
      </label>
      <label>
        Effort
        <EnumPicker
          id="property-effort"
          label="Effort"
          disabled={disabled}
          value={issue.effort ?? ""}
          options={effortOptions}
          onChange={(value) => {
            update({ kind: "effort", effort: parseEffort(value) });
          }}
        />
      </label>
    </>
  );
}

export function IssueProperties({
  issue,
  bootstrap,
  disabled,
  onDelete,
}: Props) {
  // Each edit shows at once and is saved in order; failures arrive as toasts.
  const update = (change: Exclude<IssueChange, { kind: "move" }>) => {
    void editIssue(issue.identifier, change);
  };
  const targets = [issue.identifier];
  return (
    <aside className="properties">
      <h2>Properties</h2>
      <label>
        Status
        <EnumPicker
          id="property-state"
          label="Status"
          disabled={disabled}
          value={issue.state.name}
          options={stateOptions(teamStates(bootstrap, issue.teamId))}
          onChange={(stateName) => {
            update({ kind: "state", stateName });
          }}
        />
      </label>
      <SizingFields issue={issue} disabled={disabled} update={update} />
      <PickerField
        id="property-assignee"
        name="Assignee"
        disabled={disabled}
        open={(anchor) => {
          pickProperty("assignee", targets, anchor);
        }}
      >
        {issue.assignee === null ? (
          <>
            <UserRoundX size={15} aria-hidden="true" />
            <span className="muted">Unassigned</span>
          </>
        ) : (
          <>
            <Avatar actor={issue.assignee} decorative />
            <span>{issue.assignee.name}</span>
          </>
        )}
      </PickerField>
      <PickerField
        id="property-project"
        name="Project"
        disabled={disabled}
        open={(anchor) => {
          pickProperty("project", targets, anchor);
        }}
      >
        {issue.project === null ? (
          <>
            <Folder size={15} aria-hidden="true" />
            <span className="muted">No project</span>
          </>
        ) : (
          <>
            <Swatch color={issue.project.color} />
            <span>{issue.project.name}</span>
          </>
        )}
      </PickerField>
      <PickerField
        id="property-due"
        name="Due date"
        disabled={disabled}
        prefetch={duePanel.prefetch}
        open={(anchor) => {
          pickDue(targets, anchor);
        }}
      >
        {issue.dueDate === null ? (
          <>
            <CalendarClock size={15} aria-hidden="true" />
            <span className="muted">Set due date</span>
          </>
        ) : (
          <DueDate due={issue.dueDate} state={issue.state.type} />
        )}
      </PickerField>
      <ParentField issue={issue} disabled={disabled} />
      <PickerField
        id="property-labels"
        name="Labels"
        disabled={disabled}
        open={(anchor) => {
          pickProperty("labels", targets, anchor);
        }}
      >
        {issue.labels.length === 0 ? (
          <>
            <Tag size={15} aria-hidden="true" />
            <span className="muted">Add labels</span>
          </>
        ) : (
          <span className="property-labels">
            {issue.labels.map((label) => (
              <span className="label" key={label.id}>
                <Swatch color={label.color} />
                {label.name}
              </span>
            ))}
          </span>
        )}
      </PickerField>
      <VoteButton
        issue={issue}
        disabled={disabled}
        toggle={() => {
          update({ kind: "vote", voted: !issue.viewerVoted });
        }}
      />
      <div className="created-by">
        <span className="muted">Created by</span>
        <ActorChip actor={issue.creator} />
        <AbsoluteTime value={issue.createdAt} />
      </div>
      {issue.sourceMetadata !== null && (
        <details>
          <summary>Imported metadata</summary>
          <pre>{JSON.stringify(issue.sourceMetadata, null, 2)}</pre>
        </details>
      )}
      <button
        className="text-button danger"
        disabled={disabled}
        onClick={() => {
          onDelete();
        }}
      >
        <Trash2 size={14} />
        Delete issue
      </button>
    </aside>
  );
}
