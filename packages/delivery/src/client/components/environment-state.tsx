import type { Environment, VersionSetRevision } from "#shared/contract.ts";
import { observation, versionLabel } from "#client/presentation.ts";

/**
 * Desired, observed and accepted are separate claims; show each. The observed
 * one is dated by the deployment that recorded it, not by a live probe.
 */
export function EnvironmentState({
  environment,
  versions,
  now,
}: {
  environment: Environment;
  versions: VersionSetRevision[];
  now: number;
}) {
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
      <p className="muted">{observation(environment, now)}</p>
    </section>
  );
}
