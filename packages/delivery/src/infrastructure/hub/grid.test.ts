import { describe, expect, it } from "vitest";
import { CATALOG_CORE } from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import { HubGridSchema } from "#shared/hub/hub-contract.ts";
import { index } from "#infrastructure/delivery-data.ts";
import { QUEUED_ATTENTION_MINUTES } from "./attention.ts";
import {
  buildGrid,
  type AcceptingDeployment,
  type GridDeployment,
  type GridRecord,
} from "./grid.ts";
import { servicePlacement } from "./views.ts";

type Environment = GridRecord["environments"][number];

const HOUR = 3_600_000;
const BASE = Date.parse("2026-11-01T00:00:00.000Z");
const at = (hours: number) => new Date(BASE + hours * HOUR);

function environment(
  id: string,
  overrides: Partial<Environment> = {},
): Environment {
  const [serviceId = "", name = ""] = id.split("/");
  return {
    id,
    serviceId,
    name,
    lifecycle: "active",
    promotionSourceEnvironmentId: null,
    approvalPolicy: "none",
    acceptedVersionSetRevisionId: null,
    acceptedDeploymentId: null,
    activeDeploymentId: null,
    ...overrides,
  };
}

function deployment(
  id: string,
  environmentId: string,
  overrides: Partial<GridDeployment> = {},
): GridDeployment {
  return {
    id,
    environmentId,
    serviceId: environmentId.slice(0, environmentId.indexOf("/")),
    versionSetRevisionId: "set-275",
    kind: "deploy",
    requestedBy: "operator@example.com",
    message: null,
    status: "succeeded",
    recoveryRequired: false,
    createdAt: at(0),
    startedAt: at(0),
    finishedAt: at(1),
    ...overrides,
  };
}

/** An accepting deployment no monitor alarm fired on. */
const accepted = (finishedAt: Date) => ({
  finishedAt,
  monitorState: "settled",
  monitorAlarmedAt: null,
});

function record(overrides: Partial<GridRecord> = {}): GridRecord {
  return {
    services: [],
    environments: [],
    latest: new Map(),
    awaiting: [],
    builds: new Map(),
    revisions: new Map([["set-275", 275]]),
    accepting: new Map(),
    now: at(10),
    ...overrides,
  };
}

const active = (...ids: string[]) =>
  ids.map((id) => ({ id, lifecycle: "active" }));

/** Arcade prod whose newest deployment accepted r275, as `accepting` describes it. */
function acceptedArcade(accepting: AcceptingDeployment) {
  return buildGrid(
    record({
      services: active("arcade"),
      environments: [
        environment("arcade/prod", {
          acceptedVersionSetRevisionId: "set-275",
          acceptedDeploymentId: "accepted",
        }),
      ],
      latest: new Map([["arcade/prod", deployment("accepted", "arcade/prod")]]),
      accepting: new Map([["accepted", accepting]]),
    }),
  );
}

describe("overview grid layout", () => {
  it("groups services by catalog group in catalog order, by title within a group", () => {
    const grid = buildGrid(
      record({
        services: active(
          "tofu-cloudflare",
          "flipt",
          "argocd",
          "arcade",
          "1password",
        ),
      }),
    );
    expect(
      grid.groups.map((group) => [
        group.id,
        group.title,
        group.kind,
        group.services.map((service) => service.id),
      ]),
    ).toEqual([
      ["arcade", "Arcade", "product", ["arcade"]],
      ["gitops", "GitOps & charts", "platform", ["argocd", "tofu-cloudflare"]],
      [
        "platform-services",
        "Platform services",
        "platform",
        ["1password", "flipt"],
      ],
    ]);
    expect(
      grid.groups.map((group) => group.services.map((entry) => entry.title)),
    ).toEqual([
      ["Arcade"],
      ["Argo CD", "OpenTofu cloudflare stack"],
      ["1Password Connect", "Flipt"],
    ]);
    expect(HubGridSchema.parse(grid)).toEqual(grid);
  });

  it("includes a service only the v2 catalog declares", () => {
    expect(index.byId("flipt")).toBeUndefined();
    const grid = buildGrid(
      record({
        services: active("flipt"),
        environments: [environment("flipt/prod")],
      }),
    );
    expect(grid.groups).toEqual([
      {
        id: "platform-services",
        title: "Platform services",
        kind: "platform",
        services: [
          {
            id: "flipt",
            title: "Flipt",
            environments: [
              {
                id: "flipt/prod",
                name: "prod",
                status: "not_started",
                request: null,
                alarmedAt: null,
                recoveryRequired: false,
                acceptedRevision: null,
                acceptedAt: null,
                approvalRequired: false,
                activeDeploymentId: null,
                promotesFrom: null,
              },
            ],
          },
        ],
      },
    ]);
  });

  it("orders environments along promotion edges, sources first", () => {
    const grid = buildGrid(
      record({
        services: active("scout-for-lol"),
        environments: [
          environment("scout-for-lol/prod", {
            promotionSourceEnvironmentId: "scout-for-lol/beta",
            approvalPolicy: "required",
          }),
          environment("scout-for-lol/beta"),
        ],
      }),
    );
    expect(
      grid.groups[0]?.services[0]?.environments.map((env) => [
        env.name,
        env.approvalRequired,
        env.promotesFrom,
      ]),
    ).toEqual([
      ["beta", false, null],
      ["prod", true, "scout-for-lol/beta"],
    ]);
  });

  it("draws no promotion between independent environments or from one it does not list", () => {
    const grid = buildGrid(
      record({
        services: active("cluster-nodes", "arcade"),
        environments: [
          environment("cluster-nodes/torvalds"),
          environment("cluster-nodes/liskov"),
          environment("arcade/prod", {
            promotionSourceEnvironmentId: "arcade/beta",
          }),
          environment("arcade/beta", { lifecycle: "retired" }),
        ],
      }),
    );
    expect(
      grid.groups.flatMap((group) =>
        group.services.flatMap((service) =>
          service.environments.map((env) => [env.id, env.promotesFrom]),
        ),
      ),
    ).toEqual([
      ["arcade/prod", null],
      ["cluster-nodes/liskov", null],
      ["cluster-nodes/torvalds", null],
    ]);
  });
});

describe("overview grid record", () => {
  it("leaves out an inactive service and an inactive environment", () => {
    const grid = buildGrid(
      record({
        services: [
          { id: "arcade", lifecycle: "active" },
          { id: "birmel", lifecycle: "retired" },
          { id: "tracker", lifecycle: "removed" },
        ],
        environments: [
          environment("arcade/prod"),
          environment("arcade/beta", { lifecycle: "retired" }),
          environment("birmel/prod"),
        ],
        latest: new Map([
          [
            "arcade/beta",
            deployment("old", "arcade/beta", { status: "failed" }),
          ],
        ]),
      }),
    );
    expect(grid.groups.map((group) => group.id)).toEqual(["arcade"]);
    expect(
      grid.groups[0]?.services[0]?.environments.map((env) => env.id),
    ).toEqual(["arcade/prod"]);
    // A retired environment admits no deployment, so its old failure is history.
    expect(grid.attention).toEqual([]);
  });

  it("leaves out a service this server's catalog does not declare", () => {
    const grid = buildGrid(
      record({
        services: active("outside-the-catalog", "arcade"),
        environments: [environment("outside-the-catalog/prod")],
      }),
    );
    expect(
      grid.groups.flatMap((group) => group.services.map((entry) => entry.id)),
    ).toEqual(["arcade"]);
  });

  it("models a service without environments and an environment that never deployed", () => {
    const grid = buildGrid(
      record({
        services: active("ci", "arcade"),
        environments: [environment("arcade/prod")],
      }),
    );
    const services = grid.groups.flatMap((group) => group.services);
    expect(services.find((entry) => entry.id === "ci")?.environments).toEqual(
      [],
    );
    expect(
      services.find((entry) => entry.id === "arcade")?.environments,
    ).toEqual([
      {
        id: "arcade/prod",
        name: "prod",
        status: "not_started",
        request: null,
        alarmedAt: null,
        recoveryRequired: false,
        acceptedRevision: null,
        acceptedAt: null,
        approvalRequired: false,
        activeDeploymentId: null,
        promotesFrom: null,
      },
    ]);
  });

  it("reports the newest deployment's status beside the accepted revision", () => {
    const grid = buildGrid(
      record({
        services: active("arcade"),
        environments: [
          environment("arcade/prod", {
            acceptedVersionSetRevisionId: "set-274",
            acceptedDeploymentId: "accepted",
            activeDeploymentId: "stuck",
          }),
        ],
        latest: new Map([
          [
            "arcade/prod",
            deployment("stuck", "arcade/prod", {
              status: "failed",
              recoveryRequired: true,
            }),
          ],
        ]),
        revisions: new Map([
          ["set-274", 274],
          ["set-275", 275],
        ]),
        accepting: new Map([["accepted", accepted(at(5))]]),
      }),
    );
    expect(grid.groups[0]?.services[0]?.environments[0]).toEqual({
      id: "arcade/prod",
      name: "prod",
      status: "failed",
      request: { deploymentId: "stuck", revision: 275 },
      alarmedAt: null,
      recoveryRequired: true,
      acceptedRevision: 274,
      acceptedAt: at(5).toISOString(),
      approvalRequired: false,
      activeDeploymentId: "stuck",
      promotesFrom: null,
    });
  });

  it("pairs a status with its own release: no request when the newest deployment is the accepted one", () => {
    const grid = acceptedArcade(accepted(at(1)));
    expect(grid.groups[0]?.services[0]?.environments[0]).toMatchObject({
      status: "succeeded",
      request: null,
      acceptedRevision: 275,
    });
  });

  it("calls a deployment waiting on a saved plan awaiting approval, not running", () => {
    const planning = deployment("plan", "arcade/prod", {
      status: "running",
      finishedAt: null,
    });
    const grid = buildGrid(
      record({
        services: active("arcade"),
        environments: [environment("arcade/prod")],
        latest: new Map([["arcade/prod", planning]]),
        awaiting: [planning],
      }),
    );
    expect(grid.groups[0]?.services[0]?.environments[0]).toMatchObject({
      status: "awaiting_approval",
      request: { deploymentId: "plan", revision: 275 },
    });
    expect(grid.attention).toMatchObject([
      {
        kind: "approval",
        title: "Arcade prod awaits plan approval",
        detail:
          "The saved plan for the deploy of r275, requested by operator@example.com.",
        target: { kind: "deployment", id: "plan" },
      },
    ]);
  });

  it("marks an environment whose accepted release a monitor alarm fired on", () => {
    const grid = acceptedArcade({
      finishedAt: at(1),
      monitorState: "alarmed",
      monitorAlarmedAt: at(2),
    });
    expect(grid.groups[0]?.services[0]?.environments[0]?.alarmedAt).toBe(
      at(2).toISOString(),
    );
    expect(grid.attention).toEqual([
      {
        kind: "alarm",
        title: "Arcade prod monitor alarm",
        detail:
          "A monitor alarm fired on the accepted release r275. It stays live until a rollback or a new release replaces it.",
        at: at(2).toISOString(),
        target: { kind: "environment", id: "arcade/prod" },
        serviceId: "arcade",
      },
    ]);
  });
});

/** The attention of Birmel prod with its newest deployment queued this many minutes ago. */
function queued(minutes: number, startedAt: Date | null = null) {
  return buildGrid(
    record({
      services: active("birmel"),
      environments: [environment("birmel/prod")],
      latest: new Map([
        [
          "birmel/prod",
          deployment("waiting", "birmel/prod", {
            status: "queued",
            createdAt: new Date(at(10).getTime() - minutes * 60_000),
            startedAt,
            finishedAt: null,
          }),
        ],
      ]),
    }),
  ).attention;
}

describe("overview grid queued attention", () => {
  it(`flags a deployment queued ${String(QUEUED_ATTENTION_MINUTES)} minutes or more with no stage started`, () => {
    expect(queued(50)).toEqual([
      {
        kind: "queued",
        title: "Birmel prod deployment is still queued",
        detail:
          "The deploy of r275 has started no stage since it was requested, more than 15 minutes ago.",
        at: new Date(at(10).getTime() - 50 * 60_000).toISOString(),
        target: { kind: "deployment", id: "waiting" },
        serviceId: "birmel",
      },
    ]);
    expect(queued(QUEUED_ATTENTION_MINUTES)).toHaveLength(1);
  });

  it("leaves a short queue alone, and one whose first stage has started", () => {
    expect(queued(QUEUED_ATTENTION_MINUTES - 1)).toEqual([]);
    expect(queued(50, at(9))).toEqual([]);
  });
});

describe("overview grid attention", () => {
  it("orders attention newest first and names the service and environment", () => {
    const grid = buildGrid(
      record({
        services: active("scout-for-lol", "arcade", "flipt", "birmel"),
        environments: [
          environment("scout-for-lol/prod"),
          environment("arcade/prod"),
          environment("flipt/prod"),
          environment("outside-the-catalog/prod"),
        ],
        awaiting: [
          deployment("approve", "scout-for-lol/prod", {
            status: "awaiting_approval",
            kind: "promote",
            createdAt: at(4),
            finishedAt: null,
          }),
        ],
        latest: new Map([
          [
            "scout-for-lol/prod",
            deployment("approve", "scout-for-lol/prod", {
              status: "awaiting_approval",
              createdAt: at(4),
              finishedAt: null,
            }),
          ],
          [
            "arcade/prod",
            deployment("failed", "arcade/prod", {
              status: "failed",
              message: "Sync timed out",
              finishedAt: at(2),
            }),
          ],
          [
            "flipt/prod",
            deployment("stuck", "flipt/prod", {
              status: "failed",
              recoveryRequired: true,
              message:
                "External operation may still be active; inspect its recorded identity before releasing ownership",
              finishedAt: at(6),
            }),
          ],
          [
            "outside-the-catalog/prod",
            deployment("elsewhere", "outside-the-catalog/prod", {
              status: "failed",
              finishedAt: at(1),
            }),
          ],
        ]),
        builds: new Map([
          [
            "birmel",
            {
              id: "build",
              status: "failed",
              qualificationReason: null,
              createdAt: at(3),
            },
          ],
          [
            "arcade",
            {
              id: "fine",
              status: "verified",
              qualificationReason: null,
              createdAt: at(9),
            },
          ],
        ]),
      }),
    );
    expect(
      grid.attention.map((item) => [item.kind, item.title, item.serviceId]),
    ).toEqual([
      ["recovery", "Flipt prod requires recovery", "flipt"],
      ["approval", "Scout for LoL prod awaits approval", "scout-for-lol"],
      ["build_failed", "Birmel build failed qualification", "birmel"],
      ["failed", "Arcade prod deployment failed", "arcade"],
      [
        "failed",
        "outside-the-catalog prod deployment failed",
        "outside-the-catalog",
      ],
    ]);
    // The executor's boilerplate is on the deployment page; the item says why once.
    expect(grid.attention[0]).toMatchObject({
      detail: "The deploy of r275 failed and left the environment locked.",
      target: { kind: "deployment", id: "stuck" },
    });
    expect(grid.attention[1]).toMatchObject({
      detail: "The promote of r275, requested by operator@example.com.",
      at: at(4).toISOString(),
    });
    expect(grid.attention[2]?.detail).toBe("CI did not pass");
    expect(grid.attention[3]?.detail).toBe(
      "The deploy of r275 failed: Sync timed out",
    );
  });
});

describe("overview grid contract", () => {
  it("fails on a value outside the contract instead of guessing", () => {
    const base = {
      services: active("arcade"),
      environments: [environment("arcade/prod")],
    };
    expect(() =>
      buildGrid(
        record({
          ...base,
          latest: new Map([
            ["arcade/prod", deployment("d", "arcade/prod", { status: "odd" })],
          ]),
        }),
      ),
    ).toThrow();
    expect(() =>
      buildGrid(record({ services: [{ id: "arcade", lifecycle: "paused" }] })),
    ).toThrow();
    expect(() =>
      buildGrid(
        record({
          ...base,
          environments: [
            environment("arcade/prod", { approvalPolicy: "sometimes" }),
          ],
        }),
      ),
    ).toThrow();
    expect(() =>
      buildGrid(
        record({
          ...base,
          environments: [
            environment("arcade/prod", {
              acceptedVersionSetRevisionId: "missing",
            }),
          ],
        }),
      ),
    ).toThrow("accepts a set revision the record does not hold");
    expect(() =>
      buildGrid(
        record({
          ...base,
          environments: [
            environment("arcade/prod", { acceptedDeploymentId: "missing" }),
          ],
        }),
      ),
    ).toThrow("names an accepting deployment the record does not hold");
  });

  it("fails when a catalog service names a group the catalog lacks", () => {
    expect(() =>
      buildGrid(record({ services: active("flipt") }), {
        ...CATALOG_CORE,
        groups: CATALOG_CORE.groups.filter(
          (group) => group.id !== "platform-services",
        ),
      }),
    ).toThrow("Catalog service flipt names unknown group platform-services");
  });
});

describe("service placement", () => {
  it("places every catalog and ops-model service in a catalog group", () => {
    const ids = [
      ...CATALOG_CORE.services.map((service) => service.id),
      ...index.services.map((service) => service.id),
    ];
    for (const id of ids) expect(servicePlacement(id)?.group.id).toBeDefined();
    expect(servicePlacement("gitops")).toMatchObject({
      title: "GitOps & charts",
      group: { id: "gitops" },
    });
    expect(servicePlacement("tofu-github")).toMatchObject({
      title: "OpenTofu github stack",
      group: { id: "gitops" },
    });
  });

  it("is undefined for a service neither model declares", () => {
    expect(servicePlacement("no-such-service")).toBeUndefined();
  });
});
