export const HOMELAB_RELEASE_RESULT_FILE = "homelab-release-result.json";

export type HomelabReleaseResult =
  HomelabAppliedReleaseResult | HomelabSupersededReleaseResult;

/**
 * A newer build published its apps chart first, so it owns the release. This
 * build applies nothing and succeeds; the newer build's receipt is the record.
 */
export type HomelabSupersededReleaseResult = {
  readonly schema: "homelab-release-result/v1";
  readonly outcome: "superseded";
  readonly rootApplication: "apps";
  readonly requestId: string;
  readonly revision: string;
  readonly supersededBy: string;
};

export type HomelabAppliedReleaseResult = {
  readonly schema: "homelab-release-result/v1";
  readonly outcome: "applied-verified";
  readonly rootApplication: "apps";
  readonly requestId: string;
  readonly revision: string;
  readonly resourceIdentities: readonly string[];
  readonly applications: readonly {
    readonly name: string;
    readonly revision: string;
  }[];
  readonly terminalOperationState: "terminated-after-applied";
  readonly finalHealth: "all-expected-child-applications-synced-healthy";
};

export function appliedVerifiedReleaseResult(input: {
  readonly requestId: string;
  readonly revision: string;
  readonly resourceIdentities: readonly string[];
  readonly applications: readonly {
    readonly name: string;
    readonly revision: string;
  }[];
}): HomelabAppliedReleaseResult {
  return {
    schema: "homelab-release-result/v1",
    outcome: "applied-verified",
    rootApplication: "apps",
    requestId: input.requestId,
    revision: input.revision,
    resourceIdentities: [...input.resourceIdentities].sort(),
    applications: [...input.applications].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    terminalOperationState: "terminated-after-applied",
    finalHealth: "all-expected-child-applications-synced-healthy",
  };
}

export function supersededReleaseResult(input: {
  readonly requestId: string;
  readonly revision: string;
  readonly supersededBy: string;
}): HomelabSupersededReleaseResult {
  return {
    schema: "homelab-release-result/v1",
    outcome: "superseded",
    rootApplication: "apps",
    requestId: input.requestId,
    revision: input.revision,
    supersededBy: input.supersededBy,
  };
}
