import { useState } from "react";
import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import type {
  CommitEnvironmentGroup,
  CommitService,
  CommitStatus,
  CommitSummary,
} from "#shared/hub/hub-contract.ts";
import { queries } from "#client/queries.ts";
import { PageHeader } from "#client/components/page-header.tsx";
import { Status } from "#client/components/status.tsx";
import { RelativeTime } from "#client/components/time.tsx";
import { ShortSha } from "#client/components/links.tsx";
import { OlderLink } from "#client/components/pager.tsx";
import { pageSummary } from "#client/routes/list-page.tsx";
import { SourcePanel } from "#client/components/integrations.tsx";
import { CursorSearchSchema } from "#client/routes/search-schemas.ts";
import { Route as rootRoute } from "#client/routes/root.tsx";
import { revisionLabel } from "#client/components/identifier.tsx";
import { BuildList } from "./commit-builds.tsx";
import {
  EnvironmentChip,
  EnvironmentGroup,
  Verdict,
  isLiveState,
} from "./commit-environments.tsx";
import {
  commitStatement,
  rowStanding,
  missingIdentity,
  parseSha,
  rowNotes,
  tallyText,
  unchangedLine,
  verdictView,
} from "./commit-model.ts";
import { includedIntro } from "./commit-release.ts";

/** The states of the environments a commit's blocker list names. */
const blockerStates = (blocker: CommitSummary["blocker"]) =>
  blocker === null ? [] : [blocker.state];

// Platform commits touch one environment per stack; the row shows the first few.
const MAX_TALLIES = 4;

/** "prod 14/19 live" on screen; "prod: 14 of 19 changed services live" to a screen reader. */
function Tally({
  group,
}: {
  group: Pick<
    CommitEnvironmentGroup,
    "name" | "verdict" | "liveCount" | "total"
  >;
}) {
  const text = tallyText(group);
  return (
    <Status
      value={verdictView(group.verdict).status}
      label={
        <>
          <span aria-hidden="true">{text.short}</span>
          <span className="visually-hidden">{text.full}</span>
        </>
      }
    />
  );
}

function CommitRow({ commit }: { commit: CommitSummary }) {
  return (
    <li className="commit-row">
      <Verdict
        value={commit.verdict}
        carried={commit.carriedFailures}
        pending={blockerStates(commit.blocker)}
      />
      <Link
        to="/commits/$sha"
        params={{ sha: commit.sha }}
        className="commit-subject"
      >
        <ShortSha sha={commit.sha} />
        {commit.title !== null && (
          <>
            {" "}
            <span className="commit-headline">{commit.title}</span>
          </>
        )}
      </Link>
      <span className="commit-detail">
        {commit.environments.length > 0 && (
          <span className="tallies">
            {commit.environments.slice(0, MAX_TALLIES).map((group) => (
              <Tally key={group.name} group={group} />
            ))}
            {commit.environments.length > MAX_TALLIES && (
              <span className="muted">
                +{commit.environments.length - MAX_TALLIES} more
              </span>
            )}
          </span>
        )}
        {rowNotes(commit).map((note) => (
          <span key={note} className="muted commit-note">
            {note}
          </span>
        ))}
      </span>
      <span className="commit-meta">
        {commit.author !== null && (
          <span className="commit-author">{commit.author}</span>
        )}
        {commit.seenAt !== null && <RelativeTime value={commit.seenAt} />}
      </span>
    </li>
  );
}

const SHA_HINT = "Paste 7 to 40 hex digits of a commit, such as 0f18e58.";

/**
 * Finds a commit by a pasted SHA. Surrounding spaces are dropped; anything
 * that is not 7 to 40 hex digits is answered with a hint beside the field
 * instead of the browser's generic pattern message.
 */
function FindCommit() {
  const navigate = useNavigate({ from: "/commits" });
  const [invalid, setInvalid] = useState(false);
  return (
    <section className="panel" aria-labelledby="find-heading">
      <h2 id="find-heading">Find a commit</h2>
      <form
        className="filters"
        role="search"
        aria-label="Find a commit"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("sha");
          const sha = typeof value === "string" ? parseSha(value) : null;
          setInvalid(sha === null);
          if (sha !== null)
            void navigate({ to: "/commits/$sha", params: { sha } });
        }}
      >
        <label>
          Commit SHA
          <input
            type="search"
            name="sha"
            placeholder="7 or more hex digits"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid}
            aria-describedby="sha-hint"
            onInput={() => {
              setInvalid(false);
            }}
          />
        </label>
        <button type="submit" className="secondary-button">
          Find
        </button>
        <p
          id="sha-hint"
          className={
            invalid ? "commit-find-hint commit-find-error" : "commit-find-hint"
          }
          aria-live="polite"
        >
          {invalid
            ? `That is not a commit SHA. ${SHA_HINT}`
            : "A full SHA or its first 7 digits; spaces around it are ignored."}
        </p>
      </form>
    </section>
  );
}

function CommitsPage() {
  const search = commitsRoute.useSearch();
  const { data } = useSuspenseQuery(queries.commits(search.cursor));
  return (
    <>
      <PageHeader
        eyebrow="Homelab CI/CD"
        title="Commits"
        description="Is it deployed? The newest commits, and where each one stands."
      />
      <FindCommit />
      <section className="panel" aria-labelledby="recent-heading">
        <h2 id="recent-heading">Recent commits</h2>
        {data.items.length === 0 ? (
          <p className="empty">Delivery has not seen a commit yet.</p>
        ) : (
          <div className="result-summary">
            <p role="status" className="muted">
              {pageSummary({
                count: data.items.length,
                noun: ["commit", "commits"],
                filtered: false,
                older: search.cursor !== undefined,
                more: data.nextCursor !== null,
              })}
            </p>
          </div>
        )}
        {data.items.length > 0 && (
          <div className="commit-table">
            <div className="commit-columns" aria-hidden="true">
              <span>Status</span>
              <span>Commit</span>
              <span>Changed services live, per environment</span>
              <span>Author · first seen</span>
            </div>
            <ul className="commit-list">
              {data.items.map((commit) => (
                <CommitRow key={commit.sha} commit={commit} />
              ))}
            </ul>
          </div>
        )}
        <OlderLink to="/commits" search={search} cursor={data.nextCursor} />
      </section>
    </>
  );
}

/** The release's own standing: superseded releases say so instead of the service's "Deployed". */
function ServiceStanding({ entry }: { entry: CommitService }) {
  const standing = rowStanding(
    entry,
    entry.environments
      .map((environment) => environment.state)
      .filter((state) => !isLiveState(state)),
  );
  return <Status value={standing.status} label={standing.label} />;
}

function ServiceRow({ entry }: { entry: CommitService }) {
  return (
    <tr>
      <th scope="row" data-label="Service">
        <Link
          to="/pipelines/$serviceId"
          params={{ serviceId: entry.service.id }}
        >
          {entry.service.title}
        </Link>
        {entry.versionSet !== null && (
          <small className="muted">
            {revisionLabel(entry.versionSet.revision)}
          </small>
        )}
        {/* This commit's build failed; a newer commit's release carries it. */}
        {entry.includedIn !== undefined && (
          <small className="muted">
            {" via "}
            <Link to="/commits/$sha" params={{ sha: entry.includedIn }}>
              <ShortSha sha={entry.includedIn} />
            </Link>
          </small>
        )}
      </th>
      <td data-label="Status">
        <ServiceStanding entry={entry} />
      </td>
      <td data-label="Environments">
        {entry.environments.length === 0 ? (
          <span className="muted">
            {entry.includedIn !== undefined && entry.versionSet === null
              ? "No newer release carries it yet"
              : "No environment tracks this service"}
          </span>
        ) : (
          <ul className="environment-strip">
            {entry.environments.map((environment) => (
              <li key={environment.environmentId}>
                <EnvironmentChip entry={environment} label={environment.name} />
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

/**
 * A commit's title and author. When Delivery recorded none (the commit
 * predates capture, or no build of it has been qualified since), the page
 * says so, and offers what Woodpecker's stored pipeline says as the best
 * available stand-in, named as such, instead of a blank.
 */
function CommitIdentity({ commit }: { commit: CommitStatus }) {
  const missing = missingIdentity(commit);
  return (
    <>
      {commit.title !== null && (
        <span className="commit-title">{commit.title}</span>
      )}
      {commit.author !== null && (
        <span className="commit-byline">by {commit.author}</span>
      )}
      {missing !== null && <span className="commit-byline">{missing}</span>}
    </>
  );
}

function CommitPage() {
  const { sha } = commitRoute.useParams();
  const { data } = useSuspenseQuery(queries.commit(sha));
  const carried = data.carriedFailures ?? [];
  const isCarried = (build: { id: string }) =>
    carried.some((entry) => entry.buildId === build.id);
  return (
    <>
      <PageHeader
        eyebrow={<Link to="/commits">Commits</Link>}
        title={`Commit ${data.sha.slice(0, 7)}`}
        description={
          <>
            <CommitIdentity commit={data} />
            <Verdict
              value={data.verdict}
              carried={carried}
              pending={blockerStates(data.blocker)}
            />{" "}
            <span className="commit-statement">{commitStatement(data)}</span>
          </>
        }
      />
      {data.buildId !== null && (
        <SourcePanel buildId={data.buildId} sha={data.sha} />
      )}
      <BuildList
        title="CI failed"
        intro="These services' builds failed CI or qualification, so Delivery published nothing from them. Each line quotes the reason Delivery recorded."
        builds={data.failedBuilds.filter((build) => !isCarried(build))}
      />
      <BuildList
        title="Included in a newer commit"
        intro={includedIntro(carried, data.built)}
        builds={data.failedBuilds.filter((build) => isCarried(build))}
        carried={carried}
      />
      <BuildList
        title="CI still running"
        intro="CI has not finished for these services, so nothing from them is published yet."
        builds={data.pendingBuilds}
      />
      {data.environments.length > 0 && (
        <section aria-labelledby="by-environment-heading">
          <h2 id="by-environment-heading">By environment</h2>
          {data.environments.map((group) => (
            <EnvironmentGroup key={group.name} group={group} />
          ))}
        </section>
      )}
      {data.changed.length > 0 && (
        <section className="panel" aria-labelledby="changed-heading">
          <h2 id="changed-heading">
            By service <span className="muted">({data.changed.length})</span>
          </h2>
          <div className="table-scroll">
            <table className="pipeline-table">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Status</th>
                  <th scope="col">Environments</th>
                </tr>
              </thead>
              <tbody>
                {data.changed.map((entry) => (
                  <ServiceRow key={entry.service.id} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {data.unchangedCount > 0 && (
        <p className="muted">{unchangedLine(data.unchangedCount)}</p>
      )}
    </>
  );
}

const commitsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commits",
  validateSearch: CursorSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.query({
      ...queries.commits(deps.cursor),
      staleTime: "static",
    }),
  component: CommitsPage,
});

const commitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commits/$sha",
  loader: ({ context, params }) =>
    context.queryClient.query({
      ...queries.commit(params.sha),
      staleTime: "static",
    }),
  component: CommitPage,
});

export const commitRoutes = [commitsRoute, commitRoute];
