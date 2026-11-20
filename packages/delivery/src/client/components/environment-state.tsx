import type { Environment, VersionSetRevision } from "#shared/contract.ts";
import { observation, versionLabel } from "#client/presentation.ts";
import { Fact, Facts } from "./facts.tsx";

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
      <Facts>
        <Fact label="Desired">
          {versionLabel(environment.desiredVersionSetRevisionId, versions)}
        </Fact>
        <Fact label="Observed">
          {versionLabel(environment.observedVersionSetRevisionId, versions)}
        </Fact>
        <Fact label="Accepted">
          {versionLabel(environment.acceptedVersionSetRevisionId, versions)}
        </Fact>
      </Facts>
      <p className="muted">{observation(environment, now)}</p>
    </section>
  );
}
