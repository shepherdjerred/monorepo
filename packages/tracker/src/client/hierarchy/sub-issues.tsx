import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CaseSensitive,
  CircleDashed,
  Gauge,
  GripVertical,
  Hash,
  Plus,
  SignalHigh,
  Unlink,
} from "lucide-react";
import { z } from "zod";
import type { BootstrapData, IssueDetailData } from "#client/data/api.ts";
import { editIssue } from "#client/data/mutations.ts";
import { EnumPicker, type EnumOption } from "#client/controls/enum-picker.tsx";
import { IssueSearchCombobox } from "#client/controls/issue-search.tsx";
import {
  stateOptions,
  teamStates,
} from "#client/controls/property-options.tsx";
import { useIssuePages } from "#client/issues/issue-list-query.ts";
import { Avatar } from "#client/ui/ui.tsx";
import { IssueListSchema } from "#shared/schema.ts";
import {
  adoptIssue,
  ancestorsOf,
  createSubIssue,
  ensureIssue,
} from "./hierarchy-actions.ts";
import { ProgressRing } from "./progress.tsx";
import { isComposing } from "#client/ui/ime.ts";

type Child = IssueDetailData["children"][number];

const SubIssueSortSchema = z.enum([
  "board",
  "priority",
  "status",
  "effort",
  "number",
  "title",
]);
type SubIssueSort = z.infer<typeof SubIssueSortSchema>;

const subIssueSortOptions: (EnumOption & { value: SubIssueSort })[] = [
  { value: "board", label: "Manual", icon: <GripVertical size={14} /> },
  { value: "priority", label: "Priority", icon: <SignalHigh size={14} /> },
  { value: "status", label: "Status", icon: <CircleDashed size={14} /> },
  { value: "effort", label: "Effort", icon: <Gauge size={14} /> },
  { value: "number", label: "Identifier", icon: <Hash size={14} /> },
  { value: "title", label: "Title", icon: <CaseSensitive size={14} /> },
];

const effortRank: Record<"xs" | "s" | "m" | "l" | "xl", number> = {
  xs: 1,
  s: 2,
  m: 3,
  l: 4,
  xl: 5,
};

function childNumber(identifier: string): number {
  const [, raw = "0"] = identifier.split("-");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareNullableRank(
  left: number | null,
  right: number | null,
  sign: number,
): number {
  if (left === right) return 0;
  if (left === null) return 1;
  return right === null ? -1 : (left - right) * sign;
}

const childComparators: Record<
  SubIssueSort,
  (a: Child, b: Child, sign: number) => number
> = {
  board: () => 0,
  priority: (a, b, sign) =>
    compareNullableRank(
      a.priority === 0 ? null : a.priority,
      b.priority === 0 ? null : b.priority,
      sign,
    ),
  status: (a, b, sign) => (a.state.position - b.state.position) * sign,
  effort: (a, b, sign) =>
    compareNullableRank(
      a.effort === null ? null : effortRank[a.effort],
      b.effort === null ? null : effortRank[b.effort],
      sign,
    ),
  number: (a, b, sign) =>
    (childNumber(a.identifier) - childNumber(b.identifier)) * sign,
  title: (a, b, sign) =>
    a.title.toLowerCase().localeCompare(b.title.toLowerCase()) * sign,
};

function compareChildren(
  a: Child,
  b: Child,
  sort: SubIssueSort,
  desc: boolean,
): number {
  return childComparators[sort](a, b, desc ? -1 : 1);
}

const pending = (child: Child) => child.identifier.startsWith("optimistic-");

function ChildRow({
  child,
  parent,
  bootstrap,
  disabled,
}: {
  child: Child;
  parent: IssueDetailData;
  bootstrap: BootstrapData;
  disabled: boolean;
}) {
  const saving = pending(child);
  return (
    <li
      className="sub-issue"
      data-pending={saving ? "" : undefined}
      data-sub-issue={saving ? undefined : child.identifier}
    >
      <EnumPicker
        variant="icon"
        label={`Status of ${saving ? child.title : child.identifier}`}
        value={child.state.name}
        options={stateOptions(teamStates(bootstrap, parent.teamId))}
        disabled={disabled || saving}
        onChange={(stateName) => {
          void (async () => {
            await ensureIssue(child.identifier);
            await editIssue(child.identifier, { kind: "state", stateName });
          })();
        }}
      />
      <span className="identifier">{saving ? "…" : child.identifier}</span>
      {saving ? (
        <span className="sub-issue-title">{child.title}</span>
      ) : (
        <Link className="sub-issue-title" to={`/issues/${child.identifier}`}>
          {child.title}
        </Link>
      )}
      {child.assignee !== null && <Avatar actor={child.assignee} />}
      <button
        type="button"
        className="icon-button sub-issue-remove"
        aria-label={`Remove ${child.identifier} from ${parent.identifier}`}
        title="Remove from parent"
        disabled={disabled || saving}
        onClick={() => {
          void (async () => {
            await ensureIssue(child.identifier);
            await editIssue(child.identifier, {
              kind: "parent",
              parentIdentifier: null,
            });
          })();
        }}
      >
        <Unlink size={13} />
      </button>
    </li>
  );
}

/** Enter adds one and stays for the next; Cmd/Ctrl+Enter adds and opens it. */
function AddSubIssue({ parent }: { parent: IssueDetailData }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  async function add(open: boolean) {
    const text = title.trim();
    if (text === "") {
      return;
    }
    setTitle("");
    const created = await createSubIssue(parent, text);
    if (created === undefined) {
      setTitle((current) => (current === "" ? text : current));
    } else if (open) {
      void navigate(`/issues/${created}`);
    }
  }
  return (
    <form
      className="sub-issue-add"
      onSubmit={(event) => {
        event.preventDefault();
        void add(false);
      }}
    >
      <Plus size={14} aria-hidden="true" />
      <input
        id="add-sub-issue"
        aria-label={`Add sub-issue to ${parent.identifier}`}
        placeholder="Add sub-issue…"
        value={title}
        maxLength={500}
        autoComplete="off"
        onChange={(event) => {
          setTitle(event.target.value);
        }}
        onKeyDown={(event) => {
          // The Enter that confirms an IME conversion does not add one.
          if (event.key === "Enter" && isComposing(event.nativeEvent)) {
            event.preventDefault();
            return;
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void add(true);
          }
        }}
      />
    </form>
  );
}

/**
 * An issue's sub-issues: progress, each one with its status editable in
 * place, optional sorting, a field that adds new ones by title, and a search
 * that moves an existing issue under this one.
 */
export function SubIssues({
  issue,
  bootstrap,
  disabled,
}: {
  issue: IssueDetailData;
  bootstrap: BootstrapData;
  disabled: boolean;
}) {
  const [adopting, setAdopting] = useState(false);
  const [target, setTarget] = useState("");
  const [sort, setSort] = useState<SubIssueSort>("board");
  const [desc, setDesc] = useState(false);
  // Sub-issues are edited like rows, so their rows are in the cache.
  useIssuePages(
    IssueListSchema.parse({
      teamKey: issue.team.key,
      parentIdentifier: issue.identifier,
      sort: "board",
      limit: 100,
    }),
  );
  const { children } = issue;
  const orderedChildren = useMemo(
    () =>
      sort === "board"
        ? children
        : [...children].sort((a, b) => compareChildren(a, b, sort, desc)),
    [children, sort, desc],
  );
  const done = children.filter(({ state }) => state.type === "completed");
  return (
    <section className="sub-issues" aria-labelledby="sub-issues-heading">
      <div className="section-heading">
        <h2 id="sub-issues-heading">Sub-issues</h2>
        {children.length > 0 && (
          <span className="sub-issue-progress">
            <ProgressRing
              done={done.length}
              total={children.length}
              label={`Sub-issues of ${issue.identifier} done`}
            />
            <span className="muted" aria-hidden="true">
              {done.length}/{children.length}
            </span>
          </span>
        )}
        <span className="spacer" />
        {children.length > 1 && (
          <div className="sort-control">
            <EnumPicker
              id="sub-issues-sort"
              label="Sort sub-issues"
              value={sort}
              options={subIssueSortOptions}
              onChange={(value) => {
                const next = SubIssueSortSchema.parse(value);
                setSort(next);
                setDesc(next === "number");
              }}
            />
            {sort !== "board" && (
              <button
                type="button"
                className="toolbar-button sort-dir-button"
                aria-label={`Sub-issues sort direction: ${desc ? "descending" : "ascending"}`}
                onClick={() => {
                  setDesc((current) => !current);
                }}
              >
                {desc ? (
                  <ArrowDownWideNarrow size={14} aria-hidden="true" />
                ) : (
                  <ArrowUpNarrowWide size={14} aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        )}
        {!disabled && (
          <button
            type="button"
            className="text-button"
            aria-expanded={adopting}
            onClick={() => {
              setAdopting(!adopting);
            }}
          >
            Add existing…
          </button>
        )}
      </div>
      {adopting && (
        <div className="sub-issue-adopt">
          <IssueSearchCombobox
            label={`Issue to move under ${issue.identifier}`}
            placeholder="Search for an issue to move here…"
            value={target}
            onValueChange={setTarget}
            exclude={[
              ...ancestorsOf(issue.identifier),
              ...children.map(({ identifier }) => identifier),
            ]}
            autoFocus
            onPick={(child) => {
              setTarget("");
              setAdopting(false);
              void adoptIssue(issue.identifier, child);
            }}
          />
        </div>
      )}
      {orderedChildren.length > 0 && (
        <ul className="sub-issue-list" aria-label="Sub-issues">
          {orderedChildren.map((child) => (
            <ChildRow
              key={child.identifier}
              child={child}
              parent={issue}
              bootstrap={bootstrap}
              disabled={disabled}
            />
          ))}
        </ul>
      )}
      {!disabled && issue.archivedAt === null && <AddSubIssue parent={issue} />}
    </section>
  );
}
