import { describe, expect, test } from "vitest";
import { RETRYABLE_DEPLOYMENT_KINDS } from "#shared/deployment-request-contract.ts";
import type { DeploymentV2 } from "#shared/model/contract.ts";
import {
  deploymentDetail,
  recordedDeployment,
} from "#testing/model-fixtures.ts";
import { retryRequest } from "./request.ts";

type Kind = DeploymentV2["kind"];
/** Every recorded deployment kind; the record type makes the list exhaustive. */
const KINDS: Record<Kind, Kind> = {
  deploy: "deploy",
  promote: "promote",
  rollback: "rollback",
  rebind: "rebind",
  "retire-host": "retire-host",
  "channel-publish": "channel-publish",
  "operator-run": "operator-run",
  "adopt-worker": "adopt-worker",
  "repair-trmnl": "repair-trmnl",
  "upgrade-control-plane": "upgrade-control-plane",
  "root-release": "root-release",
  "tofu-plan": "tofu-plan",
  "tofu-apply": "tofu-apply",
  carry: "carry",
};

/** Whether the API turns a failed deployment of this kind into a retry request. */
function retried(kind: Kind) {
  const detail = deploymentDetail(
    recordedDeployment({
      id: `retry-${kind}`,
      kind,
      status: "failed",
      revision: 42,
      sourceEnvironmentId: "scout-for-lol/beta",
      restoredDeploymentId: "scout-prod-38",
    }),
  );
  try {
    retryRequest(detail);
    return true;
  } catch {
    return false;
  }
}

describe("retryable deployment kinds", () => {
  test("the hub's retryable kinds are exactly the kinds the API retries", () => {
    expect(
      Object.values(KINDS)
        .filter((kind) => retried(kind))
        .toSorted(),
    ).toEqual([...RETRYABLE_DEPLOYMENT_KINDS].toSorted());
  });
});
