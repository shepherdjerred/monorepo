import { describe, expect, it } from "vitest";
import type { CommitEnvironment } from "#shared/hub/hub-contract.ts";
import {
  blockingEnvironment,
  carries,
  commitVerdict,
  decidingDeployment,
  environmentState,
  groupByEnvironment,
  rollUp,
  serviceVerdict,
  type EnvironmentFacts,
  type SetFacts,
} from "./commit-status.ts";

/** A set revision; `pipeline` gives it the order key of the main pipeline that composed it. */
function set(
  revision: number,
  lineage: string,
  pipeline: number | null = null,
): SetFacts {
  return {
    revision,
    lineage,
    order: pipeline === null ? null : { major: pipeline, minor: revision },
  };
}

const change = set(5, "lineage-a");
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
          accepted: set(5, "lineage-a"),
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
          accepted: set(9, "lineage-a"),
          locked: true,
        }),
        deployment: {
          status: "failed",
          recoveryRequired: false,
          delivers: true,
        },
        sourceLive: false,
      }),
    ).toBe("superseded");
  });

  it("does not compare revisions across lineages", () => {
    expect(
      environmentState({
        change,
        environment: environment({
          accepted: set(9, "lineage-b"),
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
          accepted: set(4, "lineage-a"),
        }),
        deployment: {
          status: "succeeded",
          recoveryRequired: false,
          delivers: true,
        },
        sourceLive: false,
      }),
    ).toBe("replaced");
  });

  it("takes success as proof where the environment accepts no selection", () => {
    // A platform apply succeeds without moving an accepted selection.
    expect(
      environmentState({
        change,
        environment: environment({ accepted: null }),
        deployment: {
          status: "succeeded",
          recoveryRequired: false,
          delivers: true,
        },
        sourceLive: false,
      }),
    ).toBe("live");
  });

  it("does not count a plan that succeeded as delivering the change", () => {
    const planned = {
      status: "succeeded",
      recoveryRequired: false,
      delivers: false,
    } as const;
    expect(
      environmentState({
        change,
        environment: environment({ accepted: null, automatic: false }),
        deployment: planned,
        sourceLive: false,
      }),
    ).toBe("manual");
    expect(
      environmentState({
        change: null,
        environment: environment({ accepted: null }),
        deployment: planned,
        sourceLive: false,
      }),
    ).toBe("not_started");
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
        deployment: { status, recoveryRequired: false, delivers: true },
        sourceLive: false,
      }),
    ).toBe(expected);
  });

  it("calls a deployment that locked the environment recovery required", () => {
    expect(
      environmentState({
        change,
        environment: environment(),
        deployment: {
          status: "failed",
          recoveryRequired: true,
          delivers: true,
        },
        sourceLive: false,
      }),
    ).toBe("recovery_required");
  });

  it("is blocked, not deploying, while another change locked the environment", () => {
    for (const deployment of [
      null,
      { status: "queued", recoveryRequired: false, delivers: true } as const,
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
        deployment: {
          status: "succeeded",
          recoveryRequired: false,
          delivers: true,
        },
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

describe("a change across a lineage change", () => {
  it("is live through a newer release of a new lineage, not replaced by it", () => {
    // Golink r2 (chart from one commit) was deployed; a component was added,
    // which started a new lineage, and r5 composed from a later pipeline is
    // accepted now. The change runs through r5.
    expect(
      environmentState({
        change: set(2, "lineage-a", 17_374),
        environment: environment({
          accepted: set(5, "lineage-b", 18_320),
        }),
        deployment: {
          status: "succeeded",
          recoveryRequired: false,
          delivers: true,
        },
        sourceLive: false,
      }),
    ).toBe("superseded");
  });
});

describe("deployments that would deliver a change", () => {
  it("carries a change in the same or a later revision of its lineage", () => {
    expect(carries(change, set(5, "lineage-a"))).toBe(true);
    expect(carries(change, set(8, "lineage-a"))).toBe(true);
    expect(carries(change, set(4, "lineage-a"))).toBe(false);
    expect(carries(change, set(9, "lineage-b"))).toBe(false);
  });

  it("carries a change across a lineage change only in a set composed from the same or a later pipeline", () => {
    const built = set(5, "lineage-a", 300);
    expect(carries(built, set(9, "lineage-b", 300))).toBe(true);
    expect(carries(built, set(9, "lineage-b", 301))).toBe(true);
    expect(carries(built, set(9, "lineage-b", 299))).toBe(false);
    // Same pipeline, registered earlier: the later registration decides.
    expect(
      carries(built, {
        revision: 9,
        lineage: "lineage-b",
        order: { major: 300, minor: 4 },
      }),
    ).toBe(false);
    // A manual hotfix has no place in main's history to compare.
    expect(carries(built, set(9, "lineage-b"))).toBe(false);
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

  it("is not deployed while the release carrying a failed build's change is not live", () => {
    // Service A deployed; B's build failed and a later passing build of B
    // carries it, but that release waits on a manual release.
    expect(
      commitVerdict({
        changed: ["deployed", "waiting"],
        failed: 1,
        carried: 1,
        pending: 0,
        builds: 2,
      }),
    ).toBe("waiting");
    // Once the carrying release is live, so is this commit.
    expect(
      commitVerdict({
        changed: ["deployed", "deployed"],
        failed: 1,
        carried: 1,
        pending: 0,
        builds: 2,
      }),
    ).toBe("deployed");
    // A failure nothing carries is still a CI failure.
    expect(
      commitVerdict({
        changed: ["deployed"],
        failed: 1,
        carried: 0,
        pending: 0,
        builds: 2,
      }),
    ).toBe("build_failed");
    // A carried failure whose carrying build changed nothing deploys nothing.
    expect(
      commitVerdict({
        changed: [],
        failed: 1,
        carried: 1,
        pending: 0,
        builds: 1,
      }),
    ).toBe("nothing_to_deploy");
  });

  it("lets an environment someone must act on outrank this commit's CI failure", () => {
    expect(rollUp(["build_failed", "recovery_required"])).toBe(
      "recovery_required",
    );
    expect(rollUp(["build_failed", "failed"])).toBe("failed");
    expect(rollUp(["build_failed", "awaiting_approval"])).toBe(
      "awaiting_approval",
    );
    // A CI failure nothing carries still outranks progress and idling.
    expect(rollUp(["build_failed", "deploying", "waiting"])).toBe(
      "build_failed",
    );
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
