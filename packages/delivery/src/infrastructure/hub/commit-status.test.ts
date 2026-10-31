import { describe, expect, it } from "vitest";
import type { CommitEnvironment } from "#shared/hub/hub-contract.ts";
import {
  environmentState,
  groupByEnvironment,
  rollUp,
  serviceVerdict,
  type EnvironmentFacts,
} from "./commit-status.ts";

const change = { revision: 5, lineage: "lineage-a" };

function environment(overrides: Partial<EnvironmentFacts> = {}) {
  return {
    id: "svc/prod",
    automatic: true,
    promotionSourceEnvironmentId: null,
    accepted: null,
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
    ).toBe("waiting");
  });

  it("does not call an older accepted revision live", () => {
    expect(
      environmentState({
        change,
        environment: environment({
          accepted: { revision: 4, lineage: "lineage-a" },
        }),
        deployment: { status: "succeeded", recoveryRequired: false },
        sourceLive: false,
      }),
    ).toBe("waiting");
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

  it("treats a quarantined deployment as failed", () => {
    expect(
      environmentState({
        change,
        environment: environment(),
        deployment: { status: "running", recoveryRequired: true },
        sourceLive: false,
      }),
    ).toBe("failed");
  });

  it("takes a platform change's success as proof it is live", () => {
    expect(
      environmentState({
        change: null,
        environment: environment(),
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

  it("expects an automatic environment to deploy on its own", () => {
    expect(
      environmentState({
        change,
        environment: environment(),
        deployment: null,
        sourceLive: false,
      }),
    ).toBe("waiting");
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
    expect(serviceVerdict("succeeded", ["live", "waiting"])).toBe("deploying");
  });

  it("puts a failure ahead of progress and approval ahead of progress", () => {
    expect(serviceVerdict("succeeded", ["failed", "deploying"])).toBe("failed");
    expect(serviceVerdict("succeeded", ["awaiting_approval", "live"])).toBe(
      "awaiting_approval",
    );
  });

  it("reports idle environments as not released", () => {
    expect(serviceVerdict("succeeded", ["live", "manual"])).toBe("waiting");
    expect(serviceVerdict("succeeded", ["canceled"])).toBe("waiting");
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
