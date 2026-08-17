export const HOMELAB_RELEASE_RESULT_FILE = "homelab-release-result.json";

export type HomelabReleaseResult = {
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
  readonly finalHealth: "all-expected-applications-synced-healthy";
};

export function appliedVerifiedReleaseResult(input: {
  readonly requestId: string;
  readonly revision: string;
  readonly resourceIdentities: readonly string[];
  readonly applications: readonly {
    readonly name: string;
    readonly revision: string;
  }[];
}): HomelabReleaseResult {
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
    finalHealth: "all-expected-applications-synced-healthy",
  };
}
