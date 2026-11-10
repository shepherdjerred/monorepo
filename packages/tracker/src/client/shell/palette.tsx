import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  History,
  Search,
} from "lucide-react";
import { api, type BootstrapData } from "#client/data/api.ts";
import { Modal, ErrorNotice } from "#client/ui/ui.tsx";
import { StateIcon } from "#client/ui/icons.tsx";
import type { IssuePrefill } from "#client/issues/issue-form.tsx";
import { matchesEntry, rootEntries } from "./palette-commands.tsx";
import type { PaletteEntry, PaletteStep } from "./palette-steps.tsx";
import { recentIssues } from "./recent-issues.ts";
import { isPlainClick } from "./route.ts";
import type { Targets } from "./shell-actions.ts";

const listId = "palette-results";
const optionId = (index: number) => `palette-option-${String(index)}`;

type IssueResult = {
  id: string;
  identifier: string;
  title: string;
  subtitle?: string;
  state?: { type: BootstrapData["states"][number]["type"]; color: string };
};

/** Issues to offer: search results while typing, else the recent ones. */
function offeredIssues(
  step: PaletteStep | undefined,
  searching: boolean,
  found: readonly IssueResult[] | undefined,
): readonly IssueResult[] {
  if (step !== undefined) {
    return [];
  }
  return searching
    ? (found ?? [])
    : recentIssues
        .read()
        .map((recent) => ({ ...recent, id: recent.identifier }));
}

function subjectOf(targets: Targets | undefined) {
  if (targets === undefined) {
    return;
  }
  const [only, ...rest] = targets.identifiers;
  return rest.length === 0
    ? only
    : `${String(targets.identifiers.length)} issues`;
}

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
}: {
  issue: IssueResult;
  index: number;
  active: boolean;
  close: () => void;
}) {
  return (
    <Link
      role="option"
      id={optionId(index)}
      aria-selected={active}
      tabIndex={-1}
      to={`/issues/${issue.identifier}`}
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

/**
 * Search and commands. Commands act on the open issue, the selection or the
 * focused row; a command ending in "…" steps into a nested list without
 * leaving the palette, and Escape or Backspace on an empty query steps out.
 */
export function Palette({
  close,
  navigate,
  create,
  action,
  bootstrap,
  targets,
  prefill,
}: {
  close: () => void;
  navigate: (to: string) => void;
  create: (prefill?: IssuePrefill) => void;
  action: (key: string) => void;
  bootstrap: BootstrapData;
  targets: Targets | undefined;
  prefill: IssuePrefill;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [steps, setSteps] = useState<readonly PaletteStep[]>([]);
  // A command that keeps the palette open changes what its rows show.
  const [, setVersion] = useState(0);
  const step = steps.at(-1);
  const searching = step === undefined && query.trim().length > 0;
  const results = useQuery({
    queryKey: ["search", query],
    queryFn: () => api.search.query.query({ query }),
    enabled: searching,
  });
  const issues = offeredIssues(step, searching, results.data?.items);
  const entries = (
    step === undefined
      ? rootEntries({ bootstrap, targets, action, navigate, create, prefill })
      : step.entries()
  ).filter((entry) => matchesEntry(entry, query));
  const count = issues.length + entries.length;
  const active = Math.min(selected, count - 1);
  function back() {
    setSteps((known) => known.slice(0, -1));
    setQuery("");
    setSelected(0);
  }
  function choose(index: number) {
    const issue = issues[index];
    if (issue !== undefined) {
      close();
      requestAnimationFrame(() => {
        navigate(`/issues/${issue.identifier}`);
      });
      return;
    }
    const entry = entries[index - issues.length];
    if (entry === undefined) {
      return;
    }
    const next = entry.step;
    if (next !== undefined) {
      setSteps((known) => [...known, next]);
      setQuery("");
      setSelected(0);
      return;
    }
    if (entry.stay === true) {
      entry.run?.();
      setVersion((version) => version + 1);
      return;
    }
    close();
    requestAnimationFrame(() => {
      entry.run?.();
    });
  }
  function move(delta: number) {
    if (count === 0) {
      return;
    }
    const next = (active + delta + count) % count;
    setSelected(next);
    document
      .querySelector(`#${optionId(next)}`)
      ?.scrollIntoView({ block: "nearest" });
  }
  const subject = subjectOf(targets);
  return (
    <Modal
      title="Search and commands"
      open
      onClose={close}
      className="palette"
      onEscape={() => {
        if (step === undefined) {
          return false;
        }
        back();
        return true;
      }}
    >
      {step !== undefined && (
        <div className="palette-steps">
          <button
            type="button"
            className="palette-back"
            aria-label="Back"
            onClick={back}
          >
            <ChevronLeft size={14} />
          </button>
          {subject !== undefined && <span className="label">{subject}</span>}
          <span className="palette-step-title">{step.title}</span>
        </div>
      )}
      <div className="palette-search">
        <Search size={19} aria-hidden="true" />
        <input
          role="combobox"
          aria-label={
            step === undefined ? "Search issues and commands" : step.title
          }
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={count === 0 ? undefined : optionId(active)}
          placeholder={step?.placeholder ?? "Search issues, or type a command…"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              move(e.key === "ArrowDown" ? 1 : -1);
            }
            if (e.key === "Enter" && count > 0) {
              e.preventDefault();
              choose(active);
            }
            if (step !== undefined && query === "" && e.key === "Backspace") {
              e.preventDefault();
              back();
            }
          }}
        />
      </div>
      {results.error !== null && <ErrorNotice error={results.error} />}
      <div
        className="palette-results"
        id={listId}
        role="listbox"
        aria-label="Results"
      >
        {issues.length > 0 && (
          <div role="group" aria-labelledby="palette-issues">
            <div className="palette-group" id="palette-issues">
              {searching ? "Issues" : "Recent issues"}
            </div>
            {issues.map((issue, index) => (
              <IssueOption
                key={issue.id}
                issue={issue}
                index={index}
                active={active === index}
                close={close}
              />
            ))}
          </div>
        )}
        {sections(entries).map((group) => (
          <div
            role="group"
            aria-labelledby={`palette-section-${String(group.start)}`}
            key={`${group.name}-${String(group.start)}`}
          >
            <div
              className="palette-group"
              id={`palette-section-${String(group.start)}`}
            >
              {group.name}
            </div>
            {group.entries.map((entry, offset) => {
              const index = issues.length + group.start + offset;
              return (
                <button
                  role="option"
                  id={optionId(index)}
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
      </div>
      {count === 0 && !results.isFetching && (
        <p className="palette-empty muted">
          No results. Try an identifier or a different phrase.
        </p>
      )}
      <div className="palette-footer">
        <span>↑ ↓ navigate</span>
        <span>↵ {step === undefined ? "open" : "choose"}</span>
        <span>Esc {step === undefined ? "close" : "back"}</span>
      </div>
    </Modal>
  );
}
