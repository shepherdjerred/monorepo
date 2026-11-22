import type { Environment } from "#shared/contract.ts";
import { observation } from "#client/presentation.ts";
import { SetRevisionLink } from "#client/model/selection-facts.tsx";
import { Fact, Facts } from "./facts.tsx";

/** A set revision the release state names: its r-number, its full id in the title. */
function Release({
  id,
  revisions,
}: {
  id: string | null;
  revisions: ReadonlyMap<string, number>;
}) {
  return id === null ? (
    "Unknown"
  ) : (
    <SetRevisionLink id={id} revisions={revisions} />
  );
}

/**
 * Desired, observed and accepted are separate claims; show each. The observed
 * one is dated by the deployment that recorded it, not by a live probe.
 * `revisions` holds the number of every set revision the page read,
 * the three named here included.
 */
export function EnvironmentState({
  environment,
  revisions,
  now,
}: {
  environment: Environment;
  revisions: ReadonlyMap<string, number>;
  now: number;
}) {
  return (
    <section className="panel" aria-labelledby="state-heading">
      <h2 id="state-heading">Release state</h2>
      <Facts>
        <Fact label="Desired">
          <Release
            id={environment.desiredVersionSetRevisionId}
            revisions={revisions}
          />
        </Fact>
        <Fact label="Observed">
          <Release
            id={environment.observedVersionSetRevisionId}
            revisions={revisions}
          />
        </Fact>
        <Fact label="Accepted">
          <Release
            id={environment.acceptedVersionSetRevisionId}
            revisions={revisions}
          />
        </Fact>
      </Facts>
      <p className="muted">{observation(environment, now)}</p>
    </section>
  );
}
