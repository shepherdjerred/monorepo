import { DeploymentStatusSchema } from "#shared/contract.ts";
import type {
  ActivityQuery,
  BuildListQuery,
  DeploymentListQuery,
} from "#shared/hub/hub-contract.ts";
import { PROBLEM_CHOICES, WITHIN_CHOICES } from "./activity-list.tsx";
import {
  boundedText,
  plainChoices,
  problemsOf,
  resolveChoice,
  resolveEnvironment,
  resolveService,
  unknownFilters,
  type CatalogService,
  type ChoiceOption,
  type FilterName,
} from "./catalog-filter.ts";

export const STATUSES = plainChoices(DeploymentStatusSchema.options);
export const QUALIFICATIONS: readonly ChoiceOption<
  "verified" | "pending" | "failed"
>[] = [
  { value: "verified", label: "verified" },
  { value: "pending", label: "pending" },
  { value: "failed", label: "failed" },
];

/** The search parameters each list filters by, under the names its controls show. */
const DEPLOYMENT_FILTERS: readonly FilterName[] = [
  { name: "service", label: "Service" },
  { name: "environment", label: "Environment" },
  { name: "status", label: "Status" },
];
const ARTIFACT_FILTERS: readonly FilterName[] = [
  { name: "service", label: "Service" },
  { name: "status", label: "Qualification" },
];
const ACTIVITY_FILTERS: readonly FilterName[] = [
  { name: "problems", label: "Show" },
  { name: "within", label: "Time range" },
  { name: "action", label: "Action prefix" },
  { name: "actor", label: "Actor" },
  { name: "entity", label: "Entity" },
];

/** The server bounds the activity filters to these lengths. */
export const ACTOR_MAX = 200;
export const ACTION_MAX = 100;
export const ENTITY_MAX = 200;

export type Search = Record<string, string | undefined>;

export function deploymentFilters(search: Search, services: CatalogService[]) {
  const service = resolveService(search["service"], services);
  const environment = resolveEnvironment(
    search["environment"],
    services,
    service.id,
  );
  const status = resolveChoice(search["status"], STATUSES, "status");
  const query: DeploymentListQuery = {
    cursor: search["cursor"],
    serviceId: service.id,
    environmentId: environment.id,
    status: status.id,
  };
  return {
    query,
    problems: problemsOf([
      service,
      environment,
      status,
      ...unknownFilters(search, DEPLOYMENT_FILTERS),
    ]),
    canonical: { service: service.id, environment: environment.id },
  };
}

export function artifactFilters(search: Search, services: CatalogService[]) {
  const service = resolveService(search["service"], services);
  const status = resolveChoice(
    search["status"],
    QUALIFICATIONS,
    "qualification",
  );
  const query: BuildListQuery = {
    cursor: search["cursor"],
    serviceId: service.id,
    status: status.id,
  };
  return {
    query,
    problems: problemsOf([
      service,
      status,
      ...unknownFilters(search, ARTIFACT_FILTERS),
    ]),
    canonical: { service: service.id },
  };
}

export function activityFilters(search: Search) {
  const actor = boundedText(search["actor"], "Actor", ACTOR_MAX);
  const action = boundedText(search["action"], "Action prefix", ACTION_MAX);
  const entity = boundedText(search["entity"], "Entity", ENTITY_MAX);
  const scope = resolveChoice(search["problems"], PROBLEM_CHOICES, "scope");
  const within = resolveChoice(search["within"], WITHIN_CHOICES, "time range");
  const query: ActivityQuery = {
    cursor: search["cursor"],
    actor: actor.id,
    action: action.id,
    entityId: entity.id,
    problems: scope.id,
    within: within.id,
  };
  return {
    query,
    problems: problemsOf([
      actor,
      action,
      entity,
      scope,
      within,
      ...unknownFilters(search, ACTIVITY_FILTERS),
    ]),
  };
}
