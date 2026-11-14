import { describe, expect, test } from "vitest";
import type { FleetNetworkPolicy, FleetService } from "./fleet.ts";
import {
  blockedConfiguredConnections,
  configuredConnections,
} from "./configured-endpoints.ts";
import {
  fleetOf,
  namespacePeer,
  policy,
  tcpPort,
  workload,
} from "./fleet-fixtures.ts";

/** `api` listens on 8080 behind a Service that publishes it as port 80. */
const API_SERVICE: FleetService = {
  namespace: "backend",
  name: "api",
  selector: { app: "api" },
  ports: [{ port: 80, targetPort: 8080, protocol: "TCP" }],
};

function fleetWith(
  env: Readonly<Record<string, string>>,
  networkPolicies: readonly FleetNetworkPolicy[] = [],
) {
  return fleetOf({
    workloads: [
      workload("frontend", "web", 3000, env),
      workload("backend", "api", 8080),
    ],
    services: [API_SERVICE],
    networkPolicies,
  });
}

const API_URL = { API_URL: "http://api.backend.svc.cluster.local" };
const BLOCKED = "frontend/web -> backend/api:80";

describe("configuredConnections", () => {
  test.each([
    ["http://api.backend.svc.cluster.local/v1", "backend/api:80"],
    ["http://api.backend:80", "backend/api:80"],
    ["grpc://api.backend.svc:80", "backend/api:80"],
    ["a.example.com:443,api.backend:80", "backend/api:80"],
  ])("resolves %s to the Service it names", (value, target) => {
    expect(
      configuredConnections(fleetWith({ UPSTREAM: value })).map(
        (connection) => [connection.env, connection.target],
      ),
    ).toEqual([["UPSTREAM", target]]);
  });

  test("a bare Service name means the workload's own namespace", () => {
    const fleet = fleetOf({
      workloads: [
        workload("backend", "worker", 3000, { API: "api:80" }),
        workload("backend", "api", 8080),
      ],
      services: [API_SERVICE],
    });
    expect(configuredConnections(fleet).map(({ target }) => target)).toEqual([
      "backend/api:80",
    ]);
  });

  test.each([
    ["a host with no port and no scheme", "api.backend"],
    ["a port the Service does not publish", "http://api.backend:8080"],
    ["a host outside the cluster", "https://api.backend.example.com"],
    ["a Service that is not rendered here", "http://other.backend:80"],
  ])("ignores %s", (_, value) => {
    expect(configuredConnections(fleetWith({ UPSTREAM: value }))).toEqual([]);
  });

  test("reads the upstream SeaweedFS S3 Service from its recorded backend", () => {
    const fleet = fleetWith({
      S3_ENDPOINT: "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
    });
    expect(configuredConnections(fleet).map(({ target }) => target)).toEqual([
      "seaweedfs/seaweedfs-s3:8333",
    ]);
  });
});

function egressTo(port: number) {
  return policy("frontend", "web", {
    egress: [{ peers: [namespacePeer("backend")], ports: [tcpPort(port)] }],
  });
}

function ingressFrom(namespace: string, port: number) {
  return policy("backend", "api", {
    ingress: [{ peers: [namespacePeer(namespace)], ports: [tcpPort(port)] }],
  });
}

describe("blockedConfiguredConnections", () => {
  test("pods no policy selects are open on both ends", () => {
    expect(blockedConfiguredConnections(fleetWith(API_URL))).toEqual([]);
  });

  test("both ends allowing the pod port leaves nothing blocked", () => {
    expect(
      blockedConfiguredConnections(
        fleetWith(API_URL, [egressTo(8080), ingressFrom("frontend", 8080)]),
      ),
    ).toEqual([]);
  });

  test("the pod port is compared, not the Service port", () => {
    expect(
      blockedConfiguredConnections(
        fleetWith(API_URL, [egressTo(80), ingressFrom("frontend", 80)]),
      ),
    ).toEqual([`${BLOCKED} (egress)`, `${BLOCKED} (ingress)`]);
  });

  test("reports the side whose policy shuts the connection out", () => {
    expect(
      blockedConfiguredConnections(
        fleetWith(API_URL, [egressTo(8080), ingressFrom("elsewhere", 8080)]),
      ),
    ).toEqual([`${BLOCKED} (ingress)`]);
  });

  test("an upstream backend is checked on the client's egress", () => {
    const fleet = fleetWith(
      { S3_ENDPOINT: "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333" },
      [egressTo(8080)],
    );
    expect(blockedConfiguredConnections(fleet)).toEqual([
      "frontend/web -> seaweedfs/seaweedfs-s3:8333 (egress)",
    ]);
  });
});
