import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";
import { ArrowUpRight, Folder } from "lucide-react";
import { api, type BootstrapData, type Issue } from "./api.ts";
import { Avatar, ErrorNotice, Priority, StateDot, timeAgo } from "./ui.tsx";
import { ActivityList } from "./activity.tsx";
export function IssueList({
  items,
  selected,
  select,
  open,
}: {
  items: Issue[];
  selected: number;
  select: (index: number) => void;
  open: (identifier: string) => void;
}) {
  return (
    <div className="issue-list" role="list" aria-label="Issues">
      {items.map((issue, index) => (
        <div
          className={`issue-row ${selected === index ? "selected" : ""}`}
          role="listitem"
          key={issue.id}
          onPointerEnter={() => {
            select(index);
          }}
        >
          <button
            className="issue-row-main"
            onClick={() => {
              open(issue.identifier);
            }}
          >
            <Priority value={issue.priority} />
            <span className="identifier">{issue.identifier}</span>
            <StateDot color={issue.state.color} />
            <span className="issue-row-title">{issue.title}</span>
          </button>
          <div className="row-labels">
            {issue.labels.slice(0, 2).map((l) => (
              <span className="label" key={l.id}>
                <i style={{ background: l.color }} />
                {l.name}
              </span>
            ))}
          </div>
          {issue.project !== null && (
            <Link
              className="row-project"
              to={`/projects/${issue.project.slug}`}
            >
              <i style={{ background: issue.project.color }} />
              {issue.project.name}
            </Link>
          )}
          {issue.voteCount > 0 && (
            <span className="row-votes">↑ {issue.voteCount}</span>
          )}
          <span className="row-date">{timeAgo(issue.updatedAt)}</span>
          {issue.assignee === null ? (
            <span className="unassigned" title="Unassigned">
              ○
            </span>
          ) : (
            <Avatar actor={issue.assignee} />
          )}
        </div>
      ))}
    </div>
  );
}

export function Projects({ bootstrap }: { bootstrap: BootstrapData }) {
  return (
    <div className="project-grid">
      {bootstrap.projects
        .filter(({ archivedAt }) => archivedAt === null)
        .map((project) => (
          <Link
            className="project-card"
            key={project.id}
            to={`/projects/${project.slug}`}
          >
            <div>
              <span className="project-symbol" style={{ color: project.color }}>
                <Folder size={23} />
              </span>
              <ArrowUpRight size={16} />
            </div>
            <h2>{project.name}</h2>
            <p>
              {project.description || "Explore issues and move work forward."}
            </p>
            <span className="muted">{project.slug}</span>
          </Link>
        ))}
    </div>
  );
}
export function GlobalActivity() {
  const query = useQuery({
    queryKey: ["global-events"],
    queryFn: () => api.events.list.query({ limit: 100 }),
  });
  return (
    <div className="reading-page">
      {query.error !== null && <ErrorNotice error={query.error} />}
      {query.data === undefined ? (
        <div className="loading">Loading activity…</div>
      ) : (
        <ActivityList events={query.data} detailed />
      )}
    </div>
  );
}
export function Actors() {
  const rest = useLocation().pathname.slice(1);
  const key = rest.startsWith("actors/")
    ? decodeURIComponent(rest.slice(7))
    : undefined;
  const actors = useQuery({
    queryKey: ["actors"],
    queryFn: () => api.actors.list.query(),
  });
  const events = useQuery({
    queryKey: ["actor-events", key],
    queryFn: () => api.actors.activity.query({ actorKey: key, limit: 100 }),
    enabled: key !== undefined,
  });
  const actor = actors.data?.find((a) => a.key === key);
  const created = useQuery({
    queryKey: ["actor-created", key],
    queryFn: () =>
      api.issues.list.query({
        creatorKey: key,
        includeArchived: true,
        limit: "all",
      }),
    enabled: key !== undefined,
  });
  const votes = useQuery({
    queryKey: ["actor-votes", key],
    queryFn: () => api.actors.votes.query({ key: key ?? "" }),
    enabled: key !== undefined,
  });
  return (
    <div className="reading-page">
      {actors.error !== null && <ErrorNotice error={actors.error} />}
      {actor === undefined ? (
        <div className="actor-grid">
          {actors.data?.map((a) => (
            <Link
              className="actor-card"
              key={a.id}
              to={`/actors/${encodeURIComponent(a.key)}`}
            >
              <Avatar actor={a} />
              <h2>{a.name}</h2>
              <span className="kind">{a.kind}</span>
              <code>{a.key}</code>
              <p>
                {a.seenCount} mutations · last seen {timeAgo(a.lastSeenAt)}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <>
          <div className="actor-profile">
            <Avatar actor={actor} />
            <h2>{actor.name}</h2>
            <span className="kind">{actor.kind}</span>
            <code>{actor.key}</code>
            <p>
              First seen {new Date(actor.firstSeenAt).toLocaleString()} ·{" "}
              {actor.seenCount} mutations
            </p>
          </div>
          <div className="metadata-grid">
            <section>
              <h3>First metadata</h3>
              <pre>{JSON.stringify(actor.firstMetadata, null, 2)}</pre>
            </section>
            <section>
              <h3>Latest metadata</h3>
              <pre>{JSON.stringify(actor.metadata, null, 2)}</pre>
            </section>
          </div>
          <section>
            <h3>Created issues</h3>
            {created.error !== null && <ErrorNotice error={created.error} />}
            {created.data?.items.map((issue) => (
              <p key={issue.id}>
                <Link to={`/issues/${issue.identifier}`}>
                  {issue.identifier} · {issue.title}
                </Link>
              </p>
            ))}
          </section>
          <section>
            <h3>Votes</h3>
            {votes.error !== null && <ErrorNotice error={votes.error} />}
            {votes.data?.map((vote) => (
              <p key={vote.identifier}>
                <Link to={`/issues/${vote.identifier}`}>
                  {vote.identifier} · {vote.title}
                </Link>
                {vote.note !== null && (
                  <span className="muted"> · {vote.note}</span>
                )}
              </p>
            ))}
          </section>
          {events.data !== undefined && (
            <ActivityList events={events.data} detailed />
          )}
        </>
      )}
    </div>
  );
}
