import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Plus, ArrowUpRight } from "lucide-react";
import { api } from "./api.ts";
import { Modal, ErrorNotice, StateDot } from "./ui.tsx";

const pages = [
  ["Issues", "/issues"],
  ["Board", "/board"],
  ["Projects", "/projects"],
  ["Actors", "/actors"],
  ["Activity", "/activity"],
  ["Settings", "/settings"],
] as const;
const issueCommands = [
  ["Set status", "s"],
  ["Set priority", "p"],
  ["Set assignee", "a"],
  ["Set labels", "l"],
  ["Set project", "P"],
  ["Vote", "v"],
  ["Edit description", "e"],
] as const;
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
  const actions = [
    { label: "Create issue", hint: "C", run: create },
    ...(currentIssue === undefined
      ? []
      : issueCommands.map(([label, key]) => ({
          label: `${label} · ${currentIssue}`,
          hint: key,
          run: () => {
            runAction(key);
          },
        }))),
    ...pages.map(([label, path]) => ({
      label: `Go to ${label.toLowerCase()}`,
      hint: "",
      run: () => {
        navigate(path);
      },
    })),
  ].filter(
    ({ label }) =>
      query === "" || label.toLowerCase().includes(query.toLowerCase()),
  );
  const items = results.data?.items ?? [];
  const count = items.length + actions.length;
  function choose(index: number) {
    const issue = items[index];
    close();
    requestAnimationFrame(() => {
      if (issue === undefined) {
        actions[index - items.length]?.run();
      } else {
        navigate(`/issues/${issue.identifier}`);
      }
    });
  }
  return (
    <Modal title="Search and commands" open onClose={close} className="palette">
      <div className="palette-search">
        <Search size={19} />
        <input
          aria-label="Search issues and commands"
          placeholder="Search issues, or type a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((previous) =>
                count === 0
                  ? 0
                  : (previous + (e.key === "ArrowDown" ? 1 : -1) + count) %
                    count,
              );
            }
            if (e.key === "Enter") {
              e.preventDefault();
              choose(selected);
            }
          }}
        />
      </div>
      <div className="palette-results">
        {results.error !== null && <ErrorNotice error={results.error} />}
        {items.length > 0 && <h3>Issues</h3>}
        {items.map((issue, index) => (
          <button
            className={selected === index ? "selected" : ""}
            key={issue.id}
            onClick={() => {
              choose(index);
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
          </button>
        ))}
        {actions.length > 0 && <h3>Commands</h3>}
        {actions.map((action, index) => (
          <button
            key={action.label}
            className={selected === items.length + index ? "selected" : ""}
            onClick={() => {
              choose(items.length + index);
            }}
          >
            <Plus size={15} />
            <span>{action.label}</span>
            <kbd>{action.hint}</kbd>
          </button>
        ))}
        {count === 0 && !results.isFetching && (
          <p className="muted">
            No results. Try an identifier or a different phrase.
          </p>
        )}
      </div>
      <div className="palette-footer">
        <span>↑ ↓ navigate</span>
        <span>↵ open</span>
        <span>Esc close</span>
      </div>
    </Modal>
  );
}
