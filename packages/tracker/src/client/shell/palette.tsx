import { useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Search } from "lucide-react";
import { api, type BootstrapData } from "#client/data/api.ts";
import { Modal, ErrorNotice } from "#client/ui/ui.tsx";
import type { IssuePrefill } from "#client/issues/issue-form.tsx";
import { rootEntries } from "./palette-commands.tsx";
import { matchesEntry, rankEntries } from "./palette-rank.ts";
import {
  PaletteResults,
  paletteListId,
  paletteOptionId,
  type ForumResult,
  type IssueResult,
} from "./palette-results.tsx";
import type { PaletteEntry, PaletteStep } from "./palette-steps.tsx";
import { recentIssues } from "./recent-issues.ts";
import type { Targets } from "./shell-actions.ts";
import { isComposing } from "#client/ui/ime.ts";
import type { SavedView } from "#client/saved-views/view-params.ts";

/** Issues to offer: search results while typing, else the recent ones. */
function offeredIssues(
  step: PaletteStep | undefined,
  searching: boolean,
  found: readonly IssueResult[] | undefined,
): readonly IssueResult[] {
  if (step !== undefined) {
    const exclude = step.issues?.exclude;
    return exclude === undefined || !searching
      ? []
      : (found ?? []).filter(({ identifier }) => !exclude.includes(identifier));
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

type Option =
  | { kind: "issue"; issue: IssueResult }
  | { kind: "forum"; thread: ForumResult }
  | { kind: "entry"; entry: PaletteEntry };

function handlePaletteKey(
  event: KeyboardEvent<HTMLInputElement>,
  options: {
    count: number;
    active: number;
    hasStep: boolean;
    query: string;
    move: (delta: number) => void;
    choose: (index: number) => void;
    back: () => void;
  },
) {
  if (isComposing(event.nativeEvent)) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    options.move(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Enter" && options.count > 0) {
    event.preventDefault();
    options.choose(options.active);
  } else if (
    options.hasStep &&
    options.query === "" &&
    event.key === "Backspace"
  ) {
    event.preventDefault();
    options.back();
  }
}

function executePaletteChoice(
  option: Option | undefined,
  handlers: {
    picking: PaletteStep["issues"] | undefined;
    close: () => void;
    navigate: (to: string) => void;
    pushStep: (next: PaletteStep) => void;
    bumpVersion: () => void;
  },
) {
  if (option === undefined) return;
  if (option.kind === "issue") {
    const { identifier } = option.issue;
    handlers.close();
    requestAnimationFrame(() => {
      if (handlers.picking === undefined) {
        handlers.navigate(`/issues/${identifier}`);
      } else {
        handlers.picking.pick(identifier);
      }
    });
    return;
  }
  if (option.kind === "forum") {
    const { identifier } = option.thread;
    handlers.close();
    requestAnimationFrame(() => {
      handlers.navigate(`/forum/${identifier}`);
    });
    return;
  }
  const { entry } = option;
  if (entry.step !== undefined) {
    handlers.pushStep(entry.step);
    return;
  }
  if (entry.stay === true) {
    entry.run?.();
    handlers.bumpVersion();
    return;
  }
  handlers.close();
  requestAnimationFrame(() => {
    entry.run?.();
  });
}

function usePaletteQueries(
  open: boolean,
  query: string,
  step: PaletteStep | undefined,
  forumEnabled: boolean,
) {
  const trimmed = query.trim();
  const searching =
    (step === undefined || step.issues !== undefined) && trimmed.length > 0;
  const searchForum = open && searching && step === undefined && forumEnabled;
  const results = useQuery({
    queryKey: ["search", query],
    queryFn: () => api.search.query.query({ query }),
    enabled: open && searching,
  });
  const forumResults = useQuery({
    queryKey: ["forum", "palette-search", trimmed],
    queryFn: () => api.forum.search.query({ query: trimmed, limit: 6 }),
    enabled: searchForum,
  });
  return {
    searching,
    issues: offeredIssues(step, searching, results.data?.items),
    forumThreads: searchForum ? (forumResults.data?.items ?? []) : [],
    error: results.error ?? forumResults.error,
    fetching: results.isFetching || forumResults.isFetching,
  };
}

export function Palette({
  open,
  close,
  navigate,
  create,
  action,
  bootstrap,
  targets,
  prefill,
  views,
  teamKey,
}: {
  open: boolean;
  close: () => void;
  navigate: (to: string) => void;
  create: (prefill?: IssuePrefill) => void;
  action: (key: string) => void;
  bootstrap: BootstrapData;
  targets: Targets | undefined;
  prefill: IssuePrefill;
  views: readonly SavedView[];
  teamKey: string;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [steps, setSteps] = useState<readonly PaletteStep[]>([]);
  const [, setVersion] = useState(0);
  const step = steps.at(-1);
  const { searching, issues, forumThreads, error, fetching } =
    usePaletteQueries(open, query, step, bootstrap.forumEnabled);
  const rawEntries =
    step === undefined
      ? rootEntries({
          bootstrap,
          targets,
          action,
          navigate,
          create,
          prefill,
          views,
          teamKey,
        })
      : step.entries(query);
  const entries = rawEntries.filter(
    (entry) => entry.always === true || matchesEntry(entry, query),
  );
  const { leading, trailing } = rankEntries(entries, query);
  const ordered: Option[] = [
    ...leading.map((entry) => ({ kind: "entry" as const, entry })),
    ...issues.map((issue) => ({ kind: "issue" as const, issue })),
    ...forumThreads.map((thread) => ({ kind: "forum" as const, thread })),
    ...trailing.map((entry) => ({ kind: "entry" as const, entry })),
  ];
  const count = ordered.length;
  const active = Math.min(selected, count - 1);
  function back() {
    setSteps((known) => known.slice(0, -1));
    setQuery("");
    setSelected(0);
  }
  function choose(index: number) {
    executePaletteChoice(ordered[index], {
      picking: step?.issues,
      close,
      navigate,
      pushStep: (next) => {
        setSteps((known) => [...known, next]);
        setQuery("");
        setSelected(0);
      },
      bumpVersion: () => {
        setVersion((version) => version + 1);
      },
    });
  }
  function move(delta: number) {
    if (count === 0) return;
    const next = (active + delta + count) % count;
    setSelected(next);
    document
      .querySelector(`#${paletteOptionId(next)}`)
      ?.scrollIntoView({ block: "nearest" });
  }
  const subject = subjectOf(targets);
  return (
    <Modal
      title="Search and commands"
      open={open}
      onClose={close}
      className="palette"
      onEscape={() => {
        if (step === undefined) return false;
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
          aria-controls={paletteListId}
          aria-autocomplete="list"
          aria-activedescendant={
            count === 0 ? undefined : paletteOptionId(active)
          }
          placeholder={step?.placeholder ?? "Search issues, or type a command…"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            handlePaletteKey(e, {
              count,
              active,
              hasStep: step !== undefined,
              query,
              move,
              choose,
              back,
            });
          }}
        />
      </div>
      {error !== null && <ErrorNotice error={error} />}
      <PaletteResults
        leading={leading}
        issues={issues}
        forumThreads={forumThreads}
        trailing={trailing}
        searching={searching}
        active={active}
        step={step}
        close={close}
        choose={choose}
      />
      {count === 0 && !fetching && (
        <p className="palette-empty muted">
          No results. Try an identifier or a different phrase.
        </p>
      )}
      <div className="palette-footer">
        <span>
          <kbd>↑↓</kbd>navigate
        </span>
        <span>
          <kbd>↵</kbd>
          {step === undefined ? "open" : "choose"}
        </span>
        <span>
          <kbd>Esc</kbd>
          {step === undefined ? "close" : "back"}
        </span>
      </div>
    </Modal>
  );
}
