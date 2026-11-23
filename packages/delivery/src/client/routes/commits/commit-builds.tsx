import { Link } from "@tanstack/react-router";
import type { CarriedFailure, CommitBuild } from "#shared/hub/hub-contract.ts";
import { ShortSha } from "#client/components/links.tsx";
import { CatalogName } from "#client/components/catalog-name.tsx";
import { carriedReleaseNote } from "./commit-release.ts";

// A commit page's lists of builds that failed or are still running, each
// named by its service with its CI run and, when a newer commit carries it,
// where its change shipped.

/** A panel of builds; nothing when there are none. */
export function BuildList({
  title,
  intro,
  builds,
  carried = [],
}: {
  title: string;
  /** One plain sentence before the recorded reasons. */
  intro: string;
  builds: readonly CommitBuild[];
  /** The newer commit that shipped each build's change, if any. */
  carried?: readonly CarriedFailure[];
}) {
  if (builds.length === 0) return null;
  return (
    <section className="panel" aria-label={title}>
      <h2>{title}</h2>
      <p>{intro}</p>
      <ul className="commit-builds">
        {builds.map((build) => (
          <li key={build.id}>
            <Link to="/builds/$" params={{ _splat: build.id }}>
              <CatalogName
                name={build.serviceTitle ?? build.serviceId}
                slug={build.serviceId}
              />
            </Link>
            {build.qualificationReason !== null && (
              <span className="muted"> · {build.qualificationReason}</span>
            )}
            <CiRun build={build} />
            <IncludedIn
              build={build}
              carried={carried.find((entry) => entry.buildId === build.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The CI run that built it, when Delivery recorded one. */
function CiRun({ build }: { build: CommitBuild }) {
  const run = build.links.find((link) => link.kind === "woodpecker");
  return run === undefined ? (
    <span className="muted"> · Delivery recorded no CI run for it</span>
  ) : (
    <>
      {" · "}
      <a href={run.url} className="tool-link tool-woodpecker">
        {run.label}
        <span aria-hidden="true"> ↗</span>
      </a>
    </>
  );
}

/**
 * The newer commit that ships it. "Passed" is that commit's build of the
 * same service; its release, which decides the commit's own verdict, is
 * named beside it so the two never contradict.
 */
function IncludedIn({
  build,
  carried,
}: {
  build: CommitBuild;
  carried: CarriedFailure | undefined;
}) {
  if (carried === undefined) return null;
  return (
    <>
      {" · included in "}
      <Link to="/commits/$sha" params={{ sha: carried.includedIn }}>
        <ShortSha sha={carried.includedIn} />
      </Link>
      , whose build of {build.serviceTitle ?? build.serviceId} passed
      {carriedReleaseNote(carried)}
    </>
  );
}
