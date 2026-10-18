import type { Environment, VersionSetRevision } from "#shared/contract.ts";
import { observation, versionLabel } from "#client/presentation.ts";

/** Desired, observed and accepted are separate claims; show each. */
export function EnvironmentState({
  environment,
  versions,
  now,
}: {
  environment: Environment;
  versions: VersionSetRevision[];
  now: number;
}) {
  const observed = observation(environment, now);
  return (
    <section className="panel" aria-labelledby="state-heading">
      <h2 id="state-heading">Release state</h2>
      <dl className="facts versions">
        <div>
          <dt>Desired</dt>
          <dd>
            {versionLabel(environment.desiredVersionSetRevisionId, versions)}
          </dd>
        </div>
        <div>
          <dt>Observed</dt>
          <dd>
            {versionLabel(environment.observedVersionSetRevisionId, versions)}
          </dd>
        </div>
        <div>
          <dt>Accepted</dt>
          <dd>
            {versionLabel(environment.acceptedVersionSetRevisionId, versions)}
          </dd>
        </div>
      </dl>
      <p className={`freshness ${observed.fresh ? "fresh" : "stale"}`}>
        <span className="dot" aria-hidden="true" />
        {observed.label}
      </p>
    </section>
  );
}
