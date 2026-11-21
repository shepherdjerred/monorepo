import { Link } from "@tanstack/react-router";
import type { GridEnvironment, GridService } from "#shared/hub/hub-contract.ts";
import {
  requestStanding,
  serviceStanding,
  standingCounts,
  type KindPanel,
  type ServiceStanding,
} from "#client/routes/overview-model.ts";
import { Revision, revisionLabel } from "./identifier.tsx";
import { Status, statusLabel } from "./status.tsx";
import { RelativeTime } from "./time.tsx";

/** The shared status a standing borrows its glyph and color from. */
const STATUS_VALUE: Record<ServiceStanding, string> = {
  succeeded: "succeeded",
  failed: "failed",
  recovery_required: "failed",
  alarmed: "alarmed",
  awaiting_approval: "awaiting_approval",
  running: "running",
  queued: "queued",
  canceled: "canceled",
  not_started: "not_started",
  no_environments: "not_started",
};

/** How many of the services stand where: "12 ok", "1 awaiting approval". */
function Counts({
  label,
  services,
}: {
  label: string;
  services: GridService[];
}) {
  return (
    <ul className="overview-counts" aria-label={label}>
      {standingCounts(services).map(({ standing, count }) => (
        <li key={standing}>
          <Status
            value={STATUS_VALUE[standing]}
            label={`${String(count)} ${standing === "succeeded" ? "ok" : statusLabel(standing)}`}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * One environment as a link to its page: its name, then the accepted release
 * and when it was accepted, then, only when the newest deployment is a
 * different one, that deployment's own release and status ("r293
 * canceled"). One release's number never sits beside another's status. The
 * words of a settled chip are hidden from sight only.
 */
function EnvironmentChip({ environment }: { environment: GridEnvironment }) {
  const { request } = environment;
  const newest = requestStanding(environment);
  return (
    <Link
      to="/environments/$"
      params={{ _splat: environment.id }}
      className={`overview-chip overview-chip-${request === null ? newest : "request"}`}
    >
      <span className="env-name">{environment.name}</span>
      {request === null && (
        <Status value={STATUS_VALUE[newest]} label={statusLabel(newest)} />
      )}
      {environment.acceptedRevision !== null && (
        <span className="overview-accepted">
          <Revision revision={environment.acceptedRevision} />
          {environment.acceptedAt !== null && (
            <>
              <span className="visually-hidden"> accepted </span>
              <RelativeTime value={environment.acceptedAt} />
            </>
          )}
        </span>
      )}
      {environment.alarmedAt !== null && (
        <Status value="alarmed" label="alarm firing" />
      )}
      {request !== null && (
        <Status
          value={STATUS_VALUE[newest]}
          label={`${revisionLabel(request.revision)} ${statusLabel(newest)}`}
        />
      )}
    </Link>
  );
}

/**
 * One service: a link to its pipeline, then its environments in promotion
 * order. An arrow joins a stage to the one it promotes from.
 */
function ServiceTile({ service }: { service: GridService }) {
  return (
    <li
      className={`overview-tile overview-standing-${serviceStanding(service)}`}
    >
      <Link
        to="/pipelines/$serviceId"
        params={{ serviceId: service.id }}
        className="overview-service"
      >
        {service.title}
      </Link>
      {service.environments.length === 0 ? (
        <p className="overview-none">No environments</p>
      ) : (
        <ol
          className="overview-chips"
          aria-label={`${service.title} environments`}
        >
          {service.environments.map((environment) => (
            <li key={environment.id}>
              {environment.promotesFrom !== null && (
                <span className="overview-arrow" aria-hidden="true">
                  →
                </span>
              )}
              <EnvironmentChip environment={environment} />
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function Tiles({ services }: { services: GridService[] }) {
  return (
    <ul className="overview-tiles">
      {services.map((service) => (
        <ServiceTile key={service.id} service={service} />
      ))}
    </ul>
  );
}

/**
 * One panel per catalog kind. Services the catalog groups alone come first
 * as plain tiles; each group of several follows under its own heading.
 */
export function OverviewPanels({ panels }: { panels: KindPanel[] }) {
  return (
    <>
      {panels.map((panel) => {
        const heading = `overview-${panel.kind}`;
        return (
          <section
            key={panel.kind}
            className="panel overview-kind"
            aria-labelledby={heading}
          >
            <div className="section-heading">
              <h2 id={heading}>{panel.title}</h2>
              <Counts
                label={`${panel.title} by status`}
                services={panel.services}
              />
            </div>
            {panel.ungrouped.length > 0 && <Tiles services={panel.ungrouped} />}
            {panel.groups.map((group) => {
              const id = `overview-group-${group.id}`;
              return (
                <section
                  key={group.id}
                  className="overview-group"
                  aria-labelledby={id}
                >
                  <div className="section-heading">
                    <h3 id={id}>{group.title}</h3>
                    <Counts
                      label={`${group.title} by status`}
                      services={group.services}
                    />
                  </div>
                  <Tiles services={group.services} />
                </section>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
