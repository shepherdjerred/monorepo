import { expect, test } from "vitest";
import {
  TEMPORAL_CLUSTER_ADDRESS,
  temporalAddress,
  temporalAddressEnv,
} from "./address.ts";

test("a client in the server's namespace dials the Service by name", () => {
  expect(temporalAddress("temporal-server")).toBe("temporal-server:7233");
  expect(temporalAddressEnv("temporal-server").TEMPORAL_ADDRESS.value).toBe(
    "temporal-server:7233",
  );
});

test("every other client dials the cluster-wide name", () => {
  expect(TEMPORAL_CLUSTER_ADDRESS).toBe(
    "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
  );
  expect(temporalAddressEnv().TEMPORAL_ADDRESS.value).toBe(
    TEMPORAL_CLUSTER_ADDRESS,
  );
});
