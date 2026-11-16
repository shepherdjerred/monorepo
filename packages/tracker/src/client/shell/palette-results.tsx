import { Link } from "react-router";
import { ArrowUpRight, Check, History, MessagesSquare } from "lucide-react";
import type { BootstrapData } from "#client/data/api.ts";
import { useViewTransitions } from "#client/feedback/motion.ts";
import { StateIcon } from "#client/ui/icons.tsx";
import type { PaletteEntry, PaletteStep } from "./palette-steps.tsx";
import { isPlainClick } from "./route.ts";

export const paletteListId = "palette-results";
export const paletteOptionId = (index: number) =>
  `palette-option-${String(index)}`;

export type IssueResult = {
  id: string;
  identifier: string;
  title: string;
  subtitle?: string;
  state?: { type: BootstrapData["states"][number]["type"]; color: string };
};

export type ForumResult = {
  id: string;
  identifier: string;
  title: string;
  searchSnippet?: string;
};

/** Consecutive entries of one section share a heading. */
function sections(entries: readonly PaletteEntry[]) {
  const groups: { name: string; entries: PaletteEntry[]; start: number }[] = [];
  entries.forEach((entry, index) => {
    const last = groups.at(-1);
    if (last?.name === entry.section) {
      last.entries.push(entry);
    } else {
      groups.push({ name: entry.section, entries: [entry], start: index });
    }
  });
  return groups;
}

function IssueOption({
  issue,
  index,
  active,
  close,
  pick,
}: {
  issue: IssueResult;
  index: number;
  active: boolean;
  close: () => void;
  pick: (() => void) | undefined;
}) {
  const viewTransition = useViewTransitions();
  if (pick !== undefined) {
    return (
      <button
        type="button"
        role="option"
        id={paletteOptionId(index)}
        aria-selected={active}
        tabIndex={-1}
        onClick={pick}
      >
        {issue.state !== undefined && (
          <StateIcon type={issue.state.type} color={issue.state.color} />
        )}
        <span className="identifier">{issue.identifier}</span>
        <span className="palette-issue-copy">
          <span>{issue.title}</span>
        </span>
      </button>
    );
  }
  return (
    <Link
      role="option"
      id={paletteOptionId(index)}
      aria-selected={active}
      tabIndex={-1}
      to={`/issues/${issue.identifier}`}
      viewTransition={viewTransition}
      onClick={(event) => {
        if (isPlainClick(event)) {
          close();
        }
      }}
    >
      {issue.state === undefined ? (
        <History size={15} aria-hidden="true" />
      ) : (
        <StateIcon type={issue.state.type} color={issue.state.color} />
      )}
      <span className="identifier">{issue.identifier}</span>
      <span className="palette-issue-copy">
        <span>{issue.title}</span>
        {issue.subtitle !== undefined && issue.subtitle !== "" && (
          <small className="muted">{issue.subtitle}</small>
        )}
      </span>
      <ArrowUpRight size={14} aria-hidden="true" />
    </Link>
  );
}

function ForumOption({
  thread,
  index,
  active,
  close,
}: {
  thread: ForumResult;
  index: number;
  active: boolean;
  close: () => void;
}) {
  const viewTransition = useViewTransitions();
  return (
    <Link
      role="option"
      id={paletteOptionId(index)}
      aria-selected={active}
      tabIndex={-1}
      to={`/forum/${thread.identifier}`}
      viewTransition={viewTransition}
      onClick={(event) => {
        if (isPlainClick(event)) {
          close();
        }
      }}
    >
      <MessagesSquare size={15} aria-hidden="true" />
      <span className="identifier">{thread.identifier}</span>
      <span className="palette-issue-copy">
        <span>{thread.title}</span>
        {thread.searchSnippet !== undefined && thread.searchSnippet !== "" && (
          <small className="muted">{thread.searchSnippet}</small>
        )}
      </span>
      <ArrowUpRight size={14} aria-hidden="true" />
    </Link>
  );
}

function EntryGroups({
  entries,
  start,
  active,
  choose,
}: {
  entries: readonly PaletteEntry[];
  start: number;
  active: number;
  choose: (index: number) => void;
}) {
  return (
    <>
      {sections(entries).map((group) => (
        <div
          role="group"
          aria-labelledby={`palette-section-${String(start + group.start)}`}
          key={`${group.name}-${String(start + group.start)}`}
        >
          <div
            className="palette-group"
            id={`palette-section-${String(start + group.start)}`}
          >
            {group.name}
          </div>
          {group.entries.map((entry, offset) => {
            const index = start + group.start + offset;
            return (
              <button
                role="option"
                id={paletteOptionId(index)}
                aria-selected={active === index}
                tabIndex={-1}
                key={entry.id}
                onClick={() => {
                  choose(index);
                }}
              >
                <span className="option-icon">{entry.icon}</span>
                <span className="option-label">{entry.label}</span>
                {entry.checked === true && (
                  <>
                    <Check
                      size={14}
                      className="menu-check"
                      aria-hidden="true"
                    />
                    <span className="sr-only">, current</span>
                  </>
                )}
                {entry.hint !== undefined && (
                  <kbd aria-hidden="true">{entry.hint}</kbd>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function PaletteResults({
  leading,
  issues,
  forumThreads,
  trailing,
  searching,
  active,
  step,
  close,
  choose,
}: {
  leading: readonly PaletteEntry[];
  issues: readonly IssueResult[];
  forumThreads: readonly ForumResult[];
  trailing: readonly PaletteEntry[];
  searching: boolean;
  active: number;
  step: PaletteStep | undefined;
  close: () => void;
  choose: (index: number) => void;
}) {
  const forumStart = leading.length + issues.length;
  return (
    <div
      className="palette-results"
      id={paletteListId}
      role="listbox"
      aria-label="Results"
    >
      <EntryGroups
        entries={leading}
        start={0}
        active={active}
        choose={choose}
      />
      {issues.length > 0 && (
        <div role="group" aria-labelledby="palette-issues">
          <div className="palette-group" id="palette-issues">
            {searching ? "Issues" : "Recent issues"}
          </div>
          {issues.map((issue, offset) => {
            const index = leading.length + offset;
            return (
              <IssueOption
                key={issue.id}
                issue={issue}
                index={index}
                active={active === index}
                close={close}
                pick={
                  step?.issues === undefined
                    ? undefined
                    : () => {
                        choose(index);
                      }
                }
              />
            );
          })}
        </div>
      )}
      {forumThreads.length > 0 && (
        <div role="group" aria-labelledby="palette-forum-threads">
          <div className="palette-group" id="palette-forum-threads">
            Forum threads
          </div>
          {forumThreads.map((thread, offset) => (
            <ForumOption
              key={thread.id}
              thread={thread}
              index={forumStart + offset}
              active={active === forumStart + offset}
              close={close}
            />
          ))}
        </div>
      )}
      <EntryGroups
        entries={trailing}
        start={forumStart + forumThreads.length}
        active={active}
        choose={choose}
      />
    </div>
  );
}
