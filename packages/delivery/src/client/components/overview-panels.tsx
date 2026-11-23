import { useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import type { GridEnvironment, GridService } from "#shared/hub/hub-contract.ts";
import {
  foldHealthy,
  requestStanding,
  serviceStanding,
  standingCounts,
  type KindPanel,
  type ServiceStanding,
} from "#client/routes/overview-model.ts";
import { Revision, revisionLabel } from "./identifier.tsx";
import { Status, statusLabel } from "./status.tsx";
import { RelativeTime } from "./time.tsx";
import { Disclosure } from "./disclosure.tsx";

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
      {environment.maintenance != null && (
        <Status
          value={environment.maintenance.status}
          label={`worker retirement ${statusLabel(environment.maintenance.status)}`}
        />
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

/** Where a phone's width begins: the width below which healthy services fold. */
const NARROW = "(width <= 600px)";

function subscribeNarrow(listener: () => void) {
  const query = globalThis.matchMedia(NARROW);
  query.addEventListener("change", listener);
  return () => {
    query.removeEventListener("change", listener);
  };
}

/** Whether the page is phone-width now; a server render is wide. */
function useNarrow() {
  return useSyncExternalStore(
    subscribeNarrow,
    () => globalThis.matchMedia(NARROW).matches,
    () => false,
  );
}

/**
 * A run of tiles. On a phone, services that need nobody fold behind a
 * closed disclosure that says how many are healthy ("All 8 healthy" when
 * nothing else is in the run) after the ones that need someone, so a screen
 * holds what matters; a wide screen shows every tile. A `whole` run (a
 * catalog group) folds only when every service in it is healthy, and
 * otherwise stays open together.
 */
function TileRun({
  services,
  healthy,
  narrow,
  whole = false,
}: {
  services: GridService[];
  healthy: ReadonlySet<string>;
  narrow: boolean;
  whole?: boolean;
}) {
  if (!narrow) return <Tiles services={services} />;
  const { open, settled } = foldHealthy(services, healthy, whole);
  return (
    <>
      {open.length > 0 && <Tiles services={open} />}
      {settled.length > 0 && (
        <Disclosure
          summary={`${open.length === 0 ? "All " : ""}${String(settled.length)} healthy`}
        >
          <Tiles services={settled} />
        </Disclosure>
      )}
    </>
  );
}

/**
 * One panel per catalog kind. Services the catalog groups alone come first
 * as plain tiles; each group of several follows under its own heading.
 */
export function OverviewPanels({ panels }: { panels: KindPanel[] }) {
  const narrow = useNarrow();
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
              {/* The panel counts the tiles directly under it; each group
                  below counts its own, so no service is counted twice. */}
              {panel.ungrouped.length > 0 && (
                <Counts
                  label={`${panel.title} by status`}
                  services={panel.ungrouped}
                />
              )}
            </div>
            {panel.ungrouped.length > 0 && (
              <TileRun
                services={panel.ungrouped}
                healthy={panel.healthy}
                narrow={narrow}
              />
            )}
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
                  <TileRun
                    services={group.services}
                    healthy={panel.healthy}
                    narrow={narrow}
                    whole
                  />
                </section>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
