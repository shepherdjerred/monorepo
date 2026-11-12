import type { CSSProperties, Ref } from "react";
import { Link } from "react-router";
import { ChevronRight, Plus } from "lucide-react";
import type { Issue } from "#client/data/api.ts";
import type { EnumOption } from "#client/controls/enum-picker.tsx";
import {
  RowAssignee,
  RowLabels,
  RowPriority,
  RowStatus,
} from "#client/controls/row-controls.tsx";
import { Avatar, Priority, Swatch } from "#client/ui/ui.tsx";
import { StateIcon } from "#client/ui/icons.tsx";
import { RelativeTime } from "#client/ui/time.tsx";
import { isPlainClick } from "#client/shell/route.ts";
import type { RowProperty } from "#client/views/display-options.ts";
import type { GroupHeader } from "#client/views/grouping.ts";

export type RowOptions = {
  states: readonly EnumOption[];
  priorities: readonly EnumOption[];
  hidden: ReadonlySet<RowProperty>;
  disabled: boolean;
};

type Placement = {
  index: number;
  measure: Ref<HTMLLIElement>;
  style: CSSProperties;
};

export function IssueRowItem({
  issue,
  position,
  setSize,
  placement,
  options,
  state,
  actions,
}: {
  issue: Issue;
  position: number;
  setSize: number;
  placement: Placement;
  options: RowOptions;
  /** `fresh`: another session created this row a moment ago. */
  state: {
    current: boolean;
    tabbable: boolean;
    selected: boolean;
    fresh: boolean;
  };
  actions: {
    focus: () => void;
    open: () => void;
    toggle: () => void;
    extend: () => void;
  };
}) {
  const { hidden } = options;
  return (
    <li
      className="issue-row"
      ref={placement.measure}
      data-index={placement.index}
      data-row-issue={issue.identifier}
      data-selected={state.selected}
      data-fresh={state.fresh ? "" : undefined}
      aria-posinset={position}
      aria-setsize={setSize}
      style={placement.style}
    >
      <input
        type="checkbox"
        className="row-check"
        tabIndex={-1}
        aria-label={`Select ${issue.identifier}`}
        checked={state.selected}
        onChange={() => {
          // Handled on click, where Shift is known.
        }}
        onClick={(event) => {
          if (event.shiftKey) {
            event.preventDefault();
            actions.extend();
          } else {
            actions.toggle();
          }
        }}
      />
      <RowPriority
        issue={issue}
        options={options.priorities}
        disabled={options.disabled}
        onFocus={actions.focus}
      />
      <RowStatus
        issue={issue}
        options={options.states}
        disabled={options.disabled}
        onFocus={actions.focus}
      />
      <Link
        className="issue-row-main"
        to={`/issues/${issue.identifier}`}
        data-issue-row={issue.identifier}
        aria-current={state.current ? "true" : undefined}
        tabIndex={state.tabbable ? 0 : -1}
        onFocus={actions.focus}
        onClick={(event) => {
          // Shift-click picks a range, as in a file list; Cmd/Ctrl-click
          // and the middle button still open a new tab.
          if (event.shiftKey && event.button === 0) {
            event.preventDefault();
            actions.extend();
          } else if (isPlainClick(event)) {
            event.preventDefault();
            actions.open();
          }
        }}
      >
        <span className="identifier">{issue.identifier}</span>
        <span className="issue-row-title">{issue.title}</span>
      </Link>
      {!hidden.has("labels") && (
        <RowLabels
          issue={issue}
          disabled={options.disabled}
          onFocus={actions.focus}
          limit={2}
        />
      )}
      {!hidden.has("project") && issue.project !== null && (
        <Link
          className="row-project"
          to={`/projects/${issue.project.slug}`}
          tabIndex={-1}
        >
          <Swatch color={issue.project.color} />
          {issue.project.name}
        </Link>
      )}
      {issue.voteCount > 0 && (
        <span className="row-votes">
          <span aria-hidden="true">↑ </span>
          {issue.voteCount}
          <span className="sr-only"> votes</span>
        </span>
      )}
      {!hidden.has("date") && (
        <RelativeTime
          className="row-date"
          value={issue.updatedAt}
          style="narrow"
        />
      )}
      {!hidden.has("assignee") && (
        <RowAssignee
          issue={issue}
          disabled={options.disabled}
          onFocus={actions.focus}
        />
      )}
    </li>
  );
}

export function GroupMarkIcon({ header }: { header: GroupHeader }) {
  const { mark } = header;
  switch (mark.type) {
    case "state": {
      return <StateIcon type={mark.state.type} color={mark.state.color} />;
    }
    case "priority": {
      return <Priority value={mark.priority} />;
    }
    case "project": {
      return mark.color === undefined ? null : <Swatch color={mark.color} />;
    }
    case "assignee": {
      return mark.actor === null ? (
        <span className="unassigned" aria-hidden="true" />
      ) : (
        <Avatar actor={mark.actor} decorative />
      );
    }
  }
}

/** A group's heading, with its count, a collapse toggle and quick create. */
export function GroupHeading({
  header,
  toggle,
  create,
  focusable = true,
}: {
  header: GroupHeader;
  toggle: () => void;
  create: (() => void) | undefined;
  focusable?: boolean;
}) {
  return (
    <div
      className="group-heading"
      data-collapsed={header.collapsed}
      data-empty={header.empty}
    >
      <h3>
        <button
          type="button"
          className="group-toggle"
          aria-expanded={!header.collapsed}
          tabIndex={focusable ? undefined : -1}
          onClick={toggle}
        >
          <ChevronRight
            size={14}
            className="group-chevron"
            aria-hidden="true"
          />
          <span className="option-icon" aria-hidden="true">
            <GroupMarkIcon header={header} />
          </span>
          <span>{header.label}</span>
          <span className="count">{header.count}</span>
        </button>
      </h3>
      {create !== undefined && (
        <button
          type="button"
          className="icon-button group-create"
          aria-label={`Create issue in ${header.label}`}
          tabIndex={focusable ? undefined : -1}
          onClick={create}
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}
