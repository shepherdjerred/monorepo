import { Link } from "@tanstack/react-router";
import type {
  CarriedFailure,
  CommitEnvironment,
  CommitEnvironmentGroup,
  CommitEnvironmentState,
  CommitVerdict,
} from "#shared/hub/hub-contract.ts";
import { Status } from "#client/components/status.tsx";
import { Disclosure } from "#client/components/disclosure.tsx";
import { ENVIRONMENT } from "./commit-labels.ts";
import { environmentView, verdictView } from "./commit-model.ts";

export const isLiveState = (state: CommitEnvironmentState) =>
  state === "live" || state === "superseded";

export function Verdict({
  value,
  carried,
  pending,
}: {
  value: CommitVerdict;
  carried?: readonly CarriedFailure[] | undefined;
  /** The states of environments that do not have the change yet. */
  pending?: readonly CommitEnvironmentState[] | undefined;
}) {
  const verdict = verdictView(value, { carried, pending });
  return <Status value={verdict.status} label={verdict.label} />;
}

export function EnvironmentChip({
  entry,
  label,
  nameFirst = false,
}: {
  entry: Pick<
    CommitEnvironment,
    "environmentId" | "state" | "deploymentId" | "release"
  >;
  label: string;
  /** Name the service first, then its state ("Temporal: not started"), for a list of services. */
  nameFirst?: boolean;
}) {
  const state = environmentView(entry);
  // Where the change is not live, or is live through a newer release, the
  // words say why; a glyph alone cannot.
  const className =
    isLiveState(entry.state) && state === ENVIRONMENT[entry.state]
      ? "env-pill"
      : "env-pill env-pill-spelled";
  const content = nameFirst ? (
    <>
      <span className="env-name">{label}:</span>
      <Status value={state.status} label={state.label} />
    </>
  ) : (
    <>
      <Status value={state.status} label={state.label} />
      <span className="env-name">{label}</span>
    </>
  );
  return entry.deploymentId === null ? (
    <Link
      to="/environments/$"
      params={{ _splat: entry.environmentId }}
      className={className}
    >
      {content}
    </Link>
  ) : (
    <Link
      to="/deployments/$deploymentId"
      params={{ deploymentId: entry.deploymentId }}
      className={className}
    >
      {content}
    </Link>
  );
}

export function EnvironmentGroup({ group }: { group: CommitEnvironmentGroup }) {
  const pending = group.members.filter((member) => !isLiveState(member.state));
  const live = group.members.filter((member) => isLiveState(member.state));
  return (
    <section
      className="panel env-group"
      aria-labelledby={`env-${group.name}-heading`}
    >
      <h3 id={`env-${group.name}-heading`}>{group.name}</h3>
      <p className="env-group-summary">
        <Verdict
          value={group.verdict}
          pending={pending.map((member) => member.state)}
        />{" "}
        <span className="muted">
          {group.liveCount} of {group.total}{" "}
          {group.total === 1 ? "service" : "services"} live.
        </span>
      </p>
      {pending.length > 0 && (
        <ul className="environment-strip">
          {pending.map((member) => (
            <li key={member.environmentId}>
              <EnvironmentChip
                entry={member}
                label={member.serviceTitle}
                nameFirst
              />
            </li>
          ))}
        </ul>
      )}
      {live.length > 0 && (
        <Disclosure summary={<>{live.length} live</>}>
          <ul className="environment-strip">
            {live.map((member) => (
              <li key={member.environmentId}>
                <EnvironmentChip
                  entry={member}
                  label={member.serviceTitle}
                  nameFirst
                />
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}
