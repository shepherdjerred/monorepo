import type {
  Deployment,
  Environment,
  Principal,
  VersionSetRevision,
} from "#shared/contract.ts";

export function canApprove(principal: Principal): boolean {
  return principal.kind === "human" && principal.scopes.includes("approve");
}

export function canDeploy(principal: Principal): boolean {
  return principal.scopes.includes("deploy");
}

export function isTerminal(deployment: Deployment): boolean {
  return ["succeeded", "failed", "canceled"].includes(deployment.status);
}

export function versionLabel(
  id: string | null,
  versions: VersionSetRevision[],
): string {
  if (id === null) return "Unknown";
  const version = versions.find((candidate) => candidate.id === id);
  return version === undefined
    ? id
    : `${version.serviceId} @ ${version.revision.toString()}`;
}

export function observation(
  environment: Environment,
  now = Date.now(),
): { label: string; fresh: boolean } {
  if (environment.observedAt === null)
    return { label: "No runtime observation", fresh: false };
  const age = Math.max(0, now - Date.parse(environment.observedAt));
  const minutes = Math.floor(age / 60_000);
  return {
    label: `${minutes < 1 ? "Just now" : `${minutes.toString()}m ago`}${age > 300_000 ? " · stale" : ""}`,
    fresh: age <= 300_000,
  };
}
