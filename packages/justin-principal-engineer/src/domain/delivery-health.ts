import type { PrHealth } from "#src/domain/schemas.ts";

function check(health: PrHealth, name: string) {
  const result = health.checks.find((candidate) => candidate.name === name);
  if (result === undefined) {
    throw new Error(`PR health omitted the ${name} check`);
  }
  return result;
}

export function deliveryIsHealthy(health: PrHealth): boolean {
  return (
    check(health, "Merge Conflicts").status === "HEALTHY" &&
    check(health, "CI Status").status === "HEALTHY"
  );
}

export function deliveryIsUnhealthy(health: PrHealth): boolean {
  return [check(health, "Merge Conflicts"), check(health, "CI Status")].some(
    ({ status }) => status === "UNHEALTHY",
  );
}

export function deliveryNeedsRestack(health: PrHealth): boolean {
  return check(health, "Merge Conflicts").status !== "HEALTHY";
}
