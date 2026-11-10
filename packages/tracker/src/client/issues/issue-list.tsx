import { Link } from "react-router";
import { Avatar, Priority, StateDot, Swatch } from "#client/ui/ui.tsx";
import { RelativeTime } from "#client/ui/time.tsx";
import { useShell } from "#client/shell/shell-context.ts";
import { isPlainClick } from "#client/shell/route.ts";

export function IssueList() {
  const { list, current, setCurrent, openPeek } = useShell();
  // One row is in the tab order; J/K and the arrow keys move between rows.
  const tabStop = list.items.some(({ identifier }) => identifier === current)
    ? current
    : list.items[0]?.identifier;
  return (
    <ul className="issue-list" aria-label="Issues">
      {list.items.map((issue) => (
        <li className="issue-row" key={issue.id}>
          <Link
            className="issue-row-main"
            to={`/issues/${issue.identifier}`}
            data-issue-row={issue.identifier}
            aria-current={current === issue.identifier ? "true" : undefined}
            tabIndex={tabStop === issue.identifier ? 0 : -1}
            onFocus={() => {
              setCurrent(issue.identifier);
            }}
            onClick={(event) => {
              if (isPlainClick(event)) {
                event.preventDefault();
                openPeek(issue.identifier);
              }
            }}
          >
            <Priority value={issue.priority} />
            <span className="identifier">{issue.identifier}</span>
            <StateDot color={issue.state.color} />
            <span className="issue-row-title">{issue.title}</span>
          </Link>
          <div className="row-labels">
            {issue.labels.slice(0, 2).map((l) => (
              <span className="label" key={l.id}>
                <Swatch color={l.color} />
                {l.name}
              </span>
            ))}
          </div>
          {issue.project !== null && (
            <Link
              className="row-project"
              to={`/projects/${issue.project.slug}`}
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
          <RelativeTime
            className="row-date"
            value={issue.updatedAt}
            style="narrow"
          />
          {issue.assignee === null ? (
            <span
              className="unassigned"
              role="img"
              aria-label="Unassigned"
              title="Unassigned"
            >
              ○
            </span>
          ) : (
            <Avatar actor={issue.assignee} />
          )}
        </li>
      ))}
    </ul>
  );
}
