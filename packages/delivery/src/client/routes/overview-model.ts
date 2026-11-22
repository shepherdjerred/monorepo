import type {
  Attention,
  GridEnvironment,
  GridEnvironmentStatus,
  GridGroup,
  GridService,
} from "#shared/hub/hub-contract.ts";
import type { PipelineSearch } from "./search-schemas.ts";

/**
 * How one environment stands in Delivery's record: recovery outranks the
 * status its newest deployment was left with, and a firing monitor alarm on
 * the accepted release outranks any wait.
 */
export type Standing = GridEnvironmentStatus | "recovery_required" | "alarmed";
/** How a whole service stands: its most urgent environment, or that it has none. */
export type ServiceStanding = Standing | "no_environments";

/** Most urgent first; a service takes the first standing any of its environments has. */
const URGENCY: Standing[] = [
  "recovery_required",
  "failed",
  "alarmed",
  "awaiting_approval",
  "running",
  "queued",
  "canceled",
  "not_started",
  "succeeded",
];

/** The newest deployment's standing alone: recovery outranks the status it was left with. */
export function requestStanding(
  environment: Pick<GridEnvironment, "status" | "recoveryRequired">,
): Standing {
  return environment.recoveryRequired
    ? "recovery_required"
    : environment.status;
}

export function environmentStanding(environment: GridEnvironment): Standing {
  const request = requestStanding(environment);
  if (request === "recovery_required" || request === "failed") return request;
  return environment.alarmedAt === null ? request : "alarmed";
}

export function serviceStanding(service: GridService): ServiceStanding {
  const standings = new Set(
    service.environments.map((environment) => environmentStanding(environment)),
  );
  return (
    URGENCY.find((standing) => standings.has(standing)) ?? "no_environments"
  );
}

type Kind = GridGroup["kind"];

/** The catalog's kinds in its own order, as the Hub's service catalog names them. */
export const KINDS: readonly { kind: Kind; title: string }[] = [
  { kind: "product", title: "Products" },
  { kind: "workload", title: "Workloads" },
  { kind: "platform", title: "Platform" },
];

/** One kind of service as the page lays it out. */
export type KindPanel = {
  kind: Kind;
  title: string;
  /** Every listed service of the kind, ungrouped and grouped. */
  services: GridService[];
  /**
   * Services the catalog groups alone. A group of one is that service, so it
   * is listed without a group heading. The panel's own counts are theirs.
   */
  ungrouped: GridService[];
  /** Catalog groups of several services, each under its own heading. */
  groups: GridGroup[];
  /**
   * The services that need nobody: every environment's newest deployment
   * succeeded (or it has none) and no attention item names the service. A
   * phone folds them.
   */
  healthy: ReadonlySet<string>;
};

/**
 * A run of tiles as a phone shows it: the services left in sight, then the
 * healthy ones folded away. A `whole` run (a catalog group) folds only when
 * every service in it is healthy; otherwise it stays in sight together.
 */
export function foldHealthy(
  services: readonly GridService[],
  healthy: ReadonlySet<string>,
  whole: boolean,
) {
  const fine = (service: GridService) => healthy.has(service.id);
  const folds = !whole || services.every((service) => fine(service));
  return {
    open: services.filter((service) => !folds || !fine(service)),
    settled: folds ? services.filter((service) => fine(service)) : [],
  };
}

/**
 * Whether a service needs nobody: no attention item names it, and every
 * environment's newest deployment succeeded, or it has no environments.
 */
export function isHealthy(service: GridService, flagged: ReadonlySet<string>) {
  const standing = serviceStanding(service);
  return (
    !flagged.has(service.id) &&
    (standing === "succeeded" || standing === "no_environments")
  );
}

/** Members that hold something needing attention first; otherwise the order given. */
function urgentFirst<T>(members: T[], urgent: (member: T) => boolean): T[] {
  return [
    ...members.filter((member) => urgent(member)),
    ...members.filter((member) => !urgent(member)),
  ];
}

/**
 * The page's panels: one per catalog kind in the catalog's order, holding the
 * services whose name or id contains the query and that have an environment
 * in the chosen status. A group or a kind left with no service is dropped.
 */
export function kindPanels(
  groups: GridGroup[],
  attention: Attention[],
  search: PipelineSearch = {},
): KindPanel[] {
  const flagged = new Set(attention.map((item) => item.serviceId));
  const query = search.q?.toLowerCase();
  const matches = (service: GridService) =>
    (query === undefined ||
      service.title.toLowerCase().includes(query) ||
      service.id.includes(query)) &&
    (search.status === undefined ||
      service.environments.some(
        (environment) => environment.status === search.status,
      ));
  return KINDS.flatMap(({ kind, title }) => {
    const members = groups.filter((group) => group.kind === kind);
    const ungrouped = urgentFirst(
      members
        .filter((group) => group.services.length === 1)
        .flatMap((group) => group.services)
        .filter((service) => matches(service)),
      (service) => flagged.has(service.id),
    );
    const grouped = urgentFirst(
      members
        .filter((group) => group.services.length > 1)
        .map((group) => ({
          ...group,
          services: group.services.filter((service) => matches(service)),
        }))
        .filter((group) => group.services.length > 0),
      (group) => group.services.some((service) => flagged.has(service.id)),
    );
    const services = [
      ...ungrouped,
      ...grouped.flatMap((group) => group.services),
    ];
    const healthy = new Set(
      services
        .filter((service) => isHealthy(service, flagged))
        .map((service) => service.id),
    );
    return services.length === 0
      ? []
      : [{ kind, title, services, ungrouped, groups: grouped, healthy }];
  });
}

/** How many services stand where: the settled count first, then the rest by urgency. */
export function standingCounts(
  services: GridService[],
): { standing: ServiceStanding; count: number }[] {
  const order: ServiceStanding[] = [
    "succeeded",
    ...URGENCY.filter((standing) => standing !== "succeeded"),
    "no_environments",
  ];
  const standings = services.map((service) => serviceStanding(service));
  return order.flatMap((standing) => {
    const count = standings.filter((entry) => entry === standing).length;
    return count === 0 ? [] : [{ standing, count }];
  });
}
