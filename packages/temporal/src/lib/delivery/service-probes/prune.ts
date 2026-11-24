import {
  retiredRouteSyncPrunes,
  type RetiredRouteRelease,
  type RetiredRouteRule,
} from "#lib/delivery/retired-route-prune.ts";

/**
 * `service-probes` owns only derived stateless `monitoring.coreos.com/v1`
 * `Probe` CRs (`probe-*`) in `prometheus`. Its owned sync may prune retired
 * owned probes when a service leaves the chart render; storage and unrelated
 * resources are never candidates.
 */
const SERVICE_PROBES: RetiredRouteRule = {
  application: "service-probes",
  chart: "service-probes",
  namespace: "prometheus",
  environmentId: "service-probes/prod",
  matches: ({ group, kind, name }) =>
    group === "monitoring.coreos.com" &&
    kind === "Probe" &&
    name.startsWith("probe-"),
  label: "Service probes",
  resourceNoun: "probe",
};

/** Retire only `service-probes`'s owned `Probe` CRs through its owned release. */
export async function serviceProbesSyncPrunes(
  release: RetiredRouteRelease,
  read: (path: string) => Promise<unknown>,
): Promise<boolean> {
  return await retiredRouteSyncPrunes(SERVICE_PROBES, release, read);
}
