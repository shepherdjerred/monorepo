import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  Activity,
  ArrowUpRight,
  CircleDot,
  Folder,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Search,
  Settings2,
  SignalHigh,
  Tag,
  ThumbsUp,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { api } from "#client/data/api.ts";
import { Modal, ErrorNotice, StateDot } from "#client/ui/ui.tsx";
import { isPlainClick } from "./route.ts";

const pages = [
  ["Issues", "/issues", List],
  ["Board", "/board", LayoutGrid],
  ["Projects", "/projects", Folder],
  ["Actors", "/actors", Users],
  ["Activity", "/activity", Activity],
  ["Settings", "/settings", Settings2],
] as const;
const issueCommands = [
  ["Set status", "s", CircleDot],
  ["Set priority", "p", SignalHigh],
  ["Set assignee", "a", UserRound],
  ["Set labels", "l", Tag],
  ["Set project", "P", Folder],
  ["Vote", "v", ThumbsUp],
  ["Edit description", "e", Pencil],
] as const;
type Command = {
  label: string;
  hint: string;
  icon: LucideIcon;
  run: () => void;
};
const listId = "palette-results";
const optionId = (index: number) => `palette-option-${String(index)}`;

export function Palette({
  close,
  navigate,
  create,
  currentIssue,
  action: runAction,
}: {
  close: () => void;
  navigate: (to: string) => void;
  create: () => void;
  currentIssue: string | undefined;
  action: (key: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const results = useQuery({
    queryKey: ["search", query],
    queryFn: () => api.search.query.query({ query }),
    enabled: query.trim().length > 0,
  });
  const commands: Command[] = [
    { label: "Create issue", hint: "C", icon: Plus, run: create },
    ...(currentIssue === undefined
      ? []
      : issueCommands.map(([label, key, icon]) => ({
          label: `${label} · ${currentIssue}`,
          hint: key,
          icon,
          run: () => {
            runAction(key);
          },
        }))),
    ...pages.map(([label, path, icon]) => ({
      label: `Go to ${label.toLowerCase()}`,
      hint: "",
      icon,
      run: () => {
        navigate(path);
      },
    })),
  ].filter(
    ({ label }) =>
      query === "" || label.toLowerCase().includes(query.toLowerCase()),
  );
  const items = results.data?.items ?? [];
  const count = items.length + commands.length;
  const active = Math.min(selected, count - 1);
  function choose(index: number) {
    const issue = items[index];
    close();
    requestAnimationFrame(() => {
      if (issue === undefined) {
        commands[index - items.length]?.run();
      } else {
        navigate(`/issues/${issue.identifier}`);
      }
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
  return (
    <Modal title="Search and commands" open onClose={close} className="palette">
      <div className="palette-search">
        <Search size={19} />
        <input
          role="combobox"
          aria-label="Search issues and commands"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={count === 0 ? undefined : optionId(active)}
          placeholder="Search issues, or type a command…"
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
        {items.length > 0 && (
          <div role="group" aria-labelledby="palette-issues">
            <div className="palette-group" id="palette-issues">
              Issues
            </div>
            {items.map((issue, index) => (
              <Link
                role="option"
                id={optionId(index)}
                aria-selected={active === index}
                tabIndex={-1}
                key={issue.id}
                to={`/issues/${issue.identifier}`}
                onClick={(event) => {
                  if (isPlainClick(event)) {
                    close();
                  }
                }}
              >
                <StateDot color={issue.state.color} />
                <span className="identifier">{issue.identifier}</span>
                <span className="palette-issue-copy">
                  <span>{issue.title}</span>
                  {issue.subtitle !== "" && (
                    <small className="muted">{issue.subtitle}</small>
                  )}
                </span>
                <ArrowUpRight size={14} />
              </Link>
            ))}
          </div>
        )}
        {commands.length > 0 && (
          <div role="group" aria-labelledby="palette-commands">
            <div className="palette-group" id="palette-commands">
              Commands
            </div>
            {commands.map((command, index) => (
              <button
                role="option"
                id={optionId(items.length + index)}
                aria-selected={active === items.length + index}
                tabIndex={-1}
                key={command.label}
                onClick={() => {
                  choose(items.length + index);
                }}
              >
                <command.icon size={15} />
                <span>{command.label}</span>
                <kbd>{command.hint}</kbd>
              </button>
            ))}
          </div>
        )}
      </div>
      {count === 0 && !results.isFetching && (
        <p className="palette-empty muted">
          No results. Try an identifier or a different phrase.
        </p>
      )}
      <div className="palette-footer">
        <span>↑ ↓ navigate</span>
        <span>↵ open</span>
        <span>Esc close</span>
      </div>
    </Modal>
  );
}
