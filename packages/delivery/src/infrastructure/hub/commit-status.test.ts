import { describe, expect, it } from "vitest";
import type { CommitEnvironment } from "#shared/hub/hub-contract.ts";
import {
  blockingEnvironment,
  carries,
  decidingDeployment,
  environmentState,
  groupByEnvironment,
  rollUp,
  serviceVerdict,
  type EnvironmentFacts,
} from "./commit-status.ts";

const change = { revision: 5, lineage: "lineage-a" };
const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 0, minute));

function environment(
  overrides: Partial<EnvironmentFacts> = {},
): EnvironmentFacts {
  return {
    id: "svc/prod",
    automatic: true,
    promotionSourceEnvironmentId: null,
    accepted: null,
    locked: false,
    ...overrides,
  };
}

describe("environmentState", () => {
  it("is live when the environment accepted exactly this revision", () => {
    expect(
      environmentState({
        change,
        environment: environment({
          accepted: { revision: 5, lineage: "lineage-a" },
        }),
        deployment: null,
        sourceLive: false,
      }),
    ).toBe("live");
  });

  it("counts a later revision of the same lineage as carrying the change", () => {
    expect(
      environmentState({
        change,
        environment: environment({
          accepted: { revision: 9, lineage: "lineage-a" },
          locked: true,
        }),
        deployment: { status: "failed", recoveryRequired: false },
        sourceLive: false,
      }),
    ).toBe("superseded");
  });

  it("does not compare revisions across lineages", () => {
    expect(
      environmentState({
        change,
        environment: environment({
          accepted: { revision: 9, lineage: "lineage-b" },
        }),
        deployment: null,
        sourceLive: false,
      }),
    ).toBe("not_started");
  });

  it("calls a change that was deployed and then replaced by an older release replaced, not deploying", () => {
    expect(
      environmentState({
        change,
        environment: environment({
          accepted: { revision: 4, lineage: "lineage-a" },
        }),
        deployment: { status: "succeeded", recoveryRequired: false },
        sourceLive: false,
      }),
    ).toBe("replaced");
  });

  it.each([
    ["running", "deploying"],
    ["queued", "deploying"],
    ["pending", "deploying"],
    ["awaiting_approval", "awaiting_approval"],
    ["failed", "failed"],
    ["canceled", "canceled"],
  ] as const)("maps a %s deployment to %s", (status, expected) => {
    expect(
      environmentState({
        change,
        environment: environment(),
        deployment: { status, recoveryRequired: false },
        sourceLive: false,
      }),
    ).toBe(expected);
  });

  it("calls a deployment that locked the environment recovery required", () => {
    expect(
      environmentState({
        change,
        environment: environment(),
        deployment: { status: "failed", recoveryRequired: true },
        sourceLive: false,
      }),
    ).toBe("recovery_required");
  });

  it("is blocked, not deploying, while another change locked the environment", () => {
    for (const deployment of [
      null,
      { status: "queued", recoveryRequired: false } as const,
    ])
      expect(
        environmentState({
          change,
          environment: environment({ automatic: false, locked: true }),
          deployment,
          sourceLive: true,
        }),
      ).toBe("recovery_required");
  });

  it("takes a platform change's success as proof it is live", () => {
    expect(
      environmentState({
        change: null,
        environment: environment({ locked: true }),
        deployment: { status: "succeeded", recoveryRequired: false },
        sourceLive: false,
      }),
    ).toBe("live");
  });

  it("waits on a promotion source, then asks for a manual release", () => {
    const promoted = environment({
      automatic: false,
      promotionSourceEnvironmentId: "svc/beta",
    });
    expect(
      environmentState({
        change,
        environment: promoted,
        deployment: null,
        sourceLive: false,
      }),
    ).toBe("waiting");
    expect(
      environmentState({
        change,
        environment: promoted,
        deployment: null,
        sourceLive: true,
      }),
    ).toBe("manual");
  });

  it("says an automatic environment that never deployed it has not started, not that it is deploying", () => {
    expect(
      environmentState({
        change,
        environment: environment(),
        deployment: null,
        sourceLive: false,
      }),
    ).toBe("not_started");
  });
});

describe("deployments that would deliver a change", () => {
  it("carries a change in the same or a later revision of its lineage", () => {
    expect(carries(change, { revision: 5, lineage: "lineage-a" })).toBe(true);
    expect(carries(change, { revision: 8, lineage: "lineage-a" })).toBe(true);
    expect(carries(change, { revision: 4, lineage: "lineage-a" })).toBe(false);
    expect(carries(change, { revision: 9, lineage: "lineage-b" })).toBe(false);
  });

  it("decides by the newest unfinished one, else the newest", () => {
    const canceled = { id: "c", status: "canceled", createdAt: at(3) } as const;
    const queued = { id: "q", status: "queued", createdAt: at(2) } as const;
    const failed = { id: "f", status: "failed", createdAt: at(1) } as const;
    expect(decidingDeployment([failed, canceled, queued])?.id).toBe("q");
    expect(decidingDeployment([failed, canceled])?.id).toBe("c");
    expect(decidingDeployment([])).toBeNull();
  });
});

describe("serviceVerdict", () => {
  it("lets the build decide before any environment", () => {
    expect(serviceVerdict("failed", ["live"])).toBe("build_failed");
    expect(serviceVerdict("pending", [])).toBe("building");
  });

  it("is deployed only when every environment has it", () => {
    expect(serviceVerdict("succeeded", ["live", "superseded"])).toBe(
      "deployed",
    );
    expect(serviceVerdict("succeeded", ["live", "deploying"])).toBe(
      "deploying",
    );
  });

  it("never says deploying when nothing is in flight", () => {
    for (const state of [
      "waiting",
      "manual",
      "canceled",
      "replaced",
      "not_started",
    ] as const)
      expect(serviceVerdict("succeeded", ["live", state])).toBe("waiting");
  });

  it("puts recovery ahead of a failure, a failure ahead of progress and approval ahead of progress", () => {
    expect(
      serviceVerdict("succeeded", ["failed", "recovery_required", "live"]),
    ).toBe("recovery_required");
    expect(serviceVerdict("succeeded", ["failed", "deploying"])).toBe("failed");
    expect(serviceVerdict("succeeded", ["awaiting_approval", "live"])).toBe(
      "awaiting_approval",
    );
  });

  it("has nothing to deploy when no environment tracks the service", () => {
    expect(serviceVerdict("succeeded", [])).toBe("nothing_to_deploy");
  });
});

describe("rollUp", () => {
  it("is unknown for no parts and otherwise the most urgent", () => {
    expect(rollUp([])).toBe("unknown");
    expect(rollUp(["deployed", "building", "failed"])).toBe("failed");
    expect(rollUp(["deployed", "nothing_to_deploy"])).toBe("deployed");
  });
});

function changed(
  id: string,
  environments: [string, CommitEnvironment["state"]][],
) {
  return {
    service: { id, title: id.toUpperCase() },
    environments: environments.map(([name, state]) => ({
      environmentId: `${id}/${name}`,
      name,
      state,
      deploymentId: null,
    })),
  };
}

describe("blockingEnvironment", () => {
  it("names the environment the verdict came from, prod before others of the same urgency", () => {
    expect(
      blockingEnvironment([
        changed("arcade", [
          ["beta", "live"],
          ["prod", "waiting"],
        ]),
        changed("media", [["beta", "manual"]]),
        changed("scout", [["prod", "manual"]]),
      ]),
    ).toEqual({ service: "SCOUT", environment: "prod", state: "manual" });
    expect(
      blockingEnvironment([
        changed("scout", [["prod", "manual"]]),
        changed("temporal", [["prod", "recovery_required"]]),
      ]),
    ).toEqual({
      service: "TEMPORAL",
      environment: "prod",
      state: "recovery_required",
    });
  });

  it("is null when every environment has the change", () => {
    expect(
      blockingEnvironment([changed("arcade", [["prod", "superseded"]])]),
    ).toBeNull();
  });
});

describe("groupByEnvironment", () => {
  it("answers per environment name, prod first, stragglers before live", () => {
    const groups = groupByEnvironment([
      changed("arcade", [
        ["beta", "live"],
        ["prod", "live"],
      ]),
      changed("birmel", [["prod", "deploying"]]),
      changed("tracker", [
        ["prod", "failed"],
        ["sandbox", "superseded"],
      ]),
    ]);
    expect(groups.map((group) => group.name)).toEqual([
      "prod",
      "beta",
      "sandbox",
    ]);
    const [prod] = groups;
    expect(prod).toMatchObject({
      verdict: "failed",
      liveCount: 1,
      total: 3,
    });
    expect(prod?.members.map((member) => member.serviceId)).toEqual([
      "tracker",
      "birmel",
      "arcade",
    ]);
    expect(groups[1]).toMatchObject({ verdict: "deployed", liveCount: 1 });
  });

  it("ignores a service that no environment tracks", () => {
    expect(groupByEnvironment([changed("glitter", [])])).toEqual([]);
  });
});
