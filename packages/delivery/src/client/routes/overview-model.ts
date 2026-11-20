import type {
  Attention,
  GridEnvironment,
  GridEnvironmentStatus,
  GridGroup,
  GridService,
} from "#shared/hub/hub-contract.ts";
import type { PipelineSearch } from "./search-schemas.ts";

/** How one environment stands in Delivery's record: recovery outranks the status it was left with. */
export type Standing = GridEnvironmentStatus | "recovery_required";
/** How a whole service stands: its most urgent environment, or that it has none. */
export type ServiceStanding = Standing | "no_environments";

/** Most urgent first; a service takes the first standing any of its environments has. */
const URGENCY: Standing[] = [
  "recovery_required",
  "failed",
  "awaiting_approval",
  "running",
  "queued",
  "canceled",
  "not_started",
  "succeeded",
];

export function environmentStanding(environment: GridEnvironment): Standing {
  return environment.recoveryRequired
    ? "recovery_required"
    : environment.status;
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
  /** Every listed service of the kind, for the panel's counts. */
  services: GridService[];
  /**
   * Services the catalog groups alone. A group of one is that service, so it
   * is listed without a group heading.
   */
  ungrouped: GridService[];
  /** Catalog groups of several services, each under its own heading. */
  groups: GridGroup[];
};

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
    return services.length === 0
      ? []
      : [{ kind, title, services, ungrouped, groups: grouped }];
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
