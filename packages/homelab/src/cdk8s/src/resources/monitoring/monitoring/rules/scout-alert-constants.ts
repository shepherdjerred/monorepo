import { SCOUT_STAGES } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/topology.ts";

export const SCOUT_TRPC_NON_FAULT_CODES = [
  "OK",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "BAD_REQUEST",
];

/** Monitor the dedicated gateway deployed in each hosted stage. */
export const SCOUT_GATEWAY_OWNER_BY_STAGE = SCOUT_STAGES.map((environment) => ({
  environment,
  role: "gateway",
}));

export function scoutGatewayAlertRoleMatcher(): string {
  return 'role="gateway"';
}

/** Scope dashboards to the gateway; application pods report disconnected. */
export const SCOUT_GATEWAY_OWNER_ROLES = [
  ...new Set(SCOUT_GATEWAY_OWNER_BY_STAGE.map((stage) => stage.role)),
];
