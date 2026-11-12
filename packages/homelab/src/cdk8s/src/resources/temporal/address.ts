import { EnvValue } from "cdk8s-plus-31";

const FRONTEND_PORT = 7233;

/**
 * The Temporal frontend's gRPC address as a client inside the `temporal`
 * namespace dials it: the server Service's name and the frontend port.
 */
export function temporalAddress(serverServiceName: string): string {
  return `${serverServiceName}:${String(FRONTEND_PORT)}`;
}

/** The frontend's address from any other namespace. */
export const TEMPORAL_CLUSTER_ADDRESS = temporalAddress(
  "temporal-temporal-server-service.temporal.svc.cluster.local",
);

/**
 * `TEMPORAL_ADDRESS` for a Temporal client. A workload that shares the
 * server's namespace passes the server Service's name; every other workload
 * leaves it out and dials the cluster-wide name.
 */
export function temporalAddressEnv(serverServiceName?: string): {
  TEMPORAL_ADDRESS: EnvValue;
} {
  return {
    TEMPORAL_ADDRESS: EnvValue.fromValue(
      serverServiceName === undefined
        ? TEMPORAL_CLUSTER_ADDRESS
        : temporalAddress(serverServiceName),
    ),
  };
}
