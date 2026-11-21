import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type {
  Attention,
  GridEnvironment,
  GridGroup,
  GridService,
} from "#shared/hub/hub-contract.ts";
import { GRID_KEY, keysForChange } from "./change-keys.ts";
import { AttentionPanel } from "./components/attention-panel.tsx";
import { OverviewPanels } from "./components/overview-panels.tsx";
import {
  foldHealthy,
  kindPanels,
  serviceStanding,
  standingCounts,
} from "./routes/overview-model.ts";
import { renderWithRouter } from "./test-router.tsx";

function environment(
  id: string,
  overrides: Partial<GridEnvironment> = {},
): GridEnvironment {
  return {
    id,
    name: id.slice(id.indexOf("/") + 1),
    status: "succeeded",
    request: null,
    alarmedAt: null,
    recoveryRequired: false,
    acceptedRevision: 274,
    acceptedAt: "2026-11-01T00:00:00.000Z",
    approvalRequired: false,
    activeDeploymentId: null,
    promotesFrom: null,
    ...overrides,
  };
}

function service(
  id: string,
  environments: GridEnvironment[] = [environment(`${id}/prod`)],
): GridService {
  return { id, title: id.toUpperCase(), environments };
}

function group(
  id: string,
  kind: GridGroup["kind"],
  services: GridService[],
): GridGroup {
  return { id, title: `Group ${id}`, kind, services };
}

function attention(serviceId: string): Attention {
  return {
    kind: "failed",
    title: `${serviceId} prod deployment failed`,
    detail: "Sync timed out",
    at: "2026-11-01T00:00:00.000Z",
    target: { kind: "deployment", id: `${serviceId}-deployment` },
    serviceId,
  };
}

const scout = service("scout", [
  environment("scout/beta"),
  environment("scout/prod", {
    status: "awaiting_approval",
    promotesFrom: "scout/beta",
  }),
]);
const GROUPS: GridGroup[] = [
  group("delivery", "platform", [service("delivery")]),
  group("arcade", "product", [service("arcade")]),
  group("scout", "product", [scout]),
  group("sites", "product", [
    service("resume"),
    service("webring", [environment("webring/prod", { status: "failed" })]),
  ]),
  group("minecraft", "product", [
    service("router"),
    service("tsmc", [
      environment("tsmc/prod", { status: "failed", recoveryRequired: true }),
    ]),
  ]),
  group("gitops", "platform", [
    service("argocd"),
    service("secrets", []),
    service("flipt", [
      environment("flipt/prod", {
        status: "not_started",
        acceptedRevision: null,
        acceptedAt: null,
      }),
    ]),
  ]),
];

function layout(panels: ReturnType<typeof kindPanels>) {
  return panels.map((panel) => [
    panel.title,
    panel.ungrouped.map((entry) => entry.id),
    panel.groups.map((entry) => [
      entry.id,
      entry.services.map((member) => member.id),
    ]),
  ]);
}

function filtered(search: Parameters<typeof kindPanels>[2]) {
  return layout(kindPanels(GROUPS, [], search));
}

describe("overview panels model", () => {
  it("takes a service's most urgent environment as its standing", () => {
    expect(serviceStanding(service("arcade"))).toBe("succeeded");
    expect(serviceStanding(scout)).toBe("awaiting_approval");
    expect(
      serviceStanding(
        service("tsmc", [
          environment("tsmc/a", { status: "running" }),
          environment("tsmc/b", { status: "failed", recoveryRequired: true }),
          environment("tsmc/c", { status: "failed" }),
        ]),
      ),
    ).toBe("recovery_required");
    expect(serviceStanding(service("secrets", []))).toBe("no_environments");
  });

  it("makes one panel per catalog kind in catalog order, lone services before groups", () => {
    expect(layout(kindPanels(GROUPS, []))).toEqual([
      [
        "Products",
        ["arcade", "scout"],
        [
          ["sites", ["resume", "webring"]],
          ["minecraft", ["router", "tsmc"]],
        ],
      ],
      ["Platform", ["delivery"], [["gitops", ["argocd", "secrets", "flipt"]]]],
    ]);
  });

  it("puts what needs attention first among the lone services and among the groups", () => {
    expect(
      layout(kindPanels(GROUPS, [attention("scout"), attention("tsmc")])),
    ).toEqual([
      [
        "Products",
        ["scout", "arcade"],
        [
          ["minecraft", ["router", "tsmc"]],
          ["sites", ["resume", "webring"]],
        ],
      ],
      ["Platform", ["delivery"], [["gitops", ["argocd", "secrets", "flipt"]]]],
    ]);
  });

  it("filters by service name or id and by an environment's status", () => {
    expect(filtered({ q: "ARC" })).toEqual([["Products", ["arcade"], []]]);
    // A group of several keeps its heading when one of its services matches.
    expect(filtered({ q: "webring" })).toEqual([
      ["Products", [], [["sites", ["webring"]]]],
    ]);
    expect(filtered({ status: "failed" })).toEqual([
      [
        "Products",
        [],
        [
          ["sites", ["webring"]],
          ["minecraft", ["tsmc"]],
        ],
      ],
    ]);
    expect(filtered({ status: "not_started" })).toEqual([
      ["Platform", [], [["gitops", ["flipt"]]]],
    ]);
    expect(filtered({ q: "no such service" })).toEqual([]);
  });

  it("counts services by standing, settled first, then by urgency", () => {
    const [products, platform] = kindPanels(GROUPS, []);
    expect(standingCounts(products?.services ?? [])).toEqual([
      { standing: "succeeded", count: 3 },
      { standing: "recovery_required", count: 1 },
      { standing: "failed", count: 1 },
      { standing: "awaiting_approval", count: 1 },
    ]);
    expect(standingCounts(platform?.services ?? [])).toEqual([
      { standing: "succeeded", count: 2 },
      { standing: "not_started", count: 1 },
      { standing: "no_environments", count: 1 },
    ]);
  });
});

function ids(list: readonly GridService[]) {
  return list.map((entry) => entry.id);
}

describe("folding healthy services on a phone", () => {
  it("names the services that need nobody: every environment succeeded and no attention item", () => {
    const [products, platform] = kindPanels(GROUPS, [attention("arcade")]);
    // Arcade succeeded but has an attention item; Scout waits for approval.
    expect([...(products?.healthy ?? [])].toSorted()).toEqual([
      "resume",
      "router",
    ]);
    // A service with no environments has nothing to watch; one not started
    // needs a look.
    expect([...(platform?.healthy ?? [])].toSorted()).toEqual([
      "argocd",
      "delivery",
      "secrets",
    ]);
  });

  it("folds healthy lone services and keeps the rest in sight", () => {
    const [products] = kindPanels(GROUPS, []);
    if (products === undefined) throw new Error("Expected the products panel");
    const lone = foldHealthy(products.ungrouped, products.healthy, false);
    expect(ids(lone.open)).toEqual(["scout"]);
    expect(ids(lone.settled)).toEqual(["arcade"]);
  });

  it("folds a group only when all of it is healthy, and keeps a mixed group whole", () => {
    const [products] = kindPanels(GROUPS, []);
    if (products === undefined) throw new Error("Expected the products panel");
    const [sites, minecraft] = products.groups;
    const mixed = foldHealthy(sites?.services ?? [], products.healthy, true);
    expect(ids(mixed.open)).toEqual(["resume", "webring"]);
    expect(mixed.settled).toEqual([]);
    const settled = foldHealthy(
      sites?.services.filter((entry) => entry.id === "resume") ?? [],
      products.healthy,
      true,
    );
    expect(ids(settled.open)).toEqual([]);
    expect(ids(settled.settled)).toEqual(["resume"]);
    expect(
      foldHealthy(minecraft?.services ?? [], products.healthy, true).settled,
    ).toEqual([]);
  });
});

describe("overview panels markup", () => {
  const html = renderWithRouter(
    <OverviewPanels panels={kindPanels(GROUPS, [])} />,
  );

  it("names each kind panel and each group of several by its heading", () => {
    expect(html).toContain(
      '<section class="panel overview-kind" aria-labelledby="overview-product">',
    );
    expect(html).toContain('<h2 id="overview-product">Products</h2>');
    expect(html).toContain(
      '<section class="overview-group" aria-labelledby="overview-group-sites">',
    );
    expect(html).toContain('<h3 id="overview-group-sites">Group sites</h3>');
    // A lone service is a tile with no group heading of its own.
    expect(html).not.toContain("Group arcade");
  });

  it("states each count as glyph, words and color", () => {
    expect(html).toContain(
      '<ul class="overview-counts" aria-label="Products by status">' +
        '<li><span class="status status-succeeded"><span class="status-glyph" aria-hidden="true">✓</span>' +
        '<span class="status-label">3 ok</span></span></li>',
    );
    expect(html).toContain(
      '<span class="status-label">1 recovery required</span>',
    );
    expect(html).toContain(
      '<span class="status-label">1 no environments</span>',
    );
  });

  it("links a tile to its pipeline and each chip to its environment", () => {
    expect(html).toContain(
      '<a href="/pipelines/scout" class="overview-service">SCOUT</a>',
    );
    expect(html).toContain(
      '<ol class="overview-chips" aria-label="SCOUT environments">',
    );
    expect(html).toContain('href="/environments/scout/beta"');
    expect(html).toContain('href="/environments/scout/prod"');
    expect(html).toContain('<p class="overview-none">No environments</p>');
  });

  it("keeps a chip's status words, revision and age in its accessible text", () => {
    expect(html).toContain(
      '<a href="/environments/arcade/prod" class="overview-chip overview-chip-succeeded">' +
        '<span class="env-name">prod</span>' +
        '<span class="status status-succeeded"><span class="status-glyph" aria-hidden="true">✓</span>' +
        '<span class="status-label">succeeded</span></span>' +
        '<span class="overview-accepted"><span class="revision">r274</span>' +
        '<span class="visually-hidden"> accepted </span>',
    );
    // Recovery outranks the failed status it was left with.
    expect(html).toContain(
      '<span class="status status-failed"><span class="status-glyph" aria-hidden="true">✕</span>' +
        '<span class="status-label">recovery required</span></span>',
    );
    // Nothing accepted: no revision and no age to show.
    expect(html).toContain(
      '<span class="status-label">not started</span></span></a>',
    );
  });

  it("shows a newer request beside the accepted release, each with its own revision", () => {
    const chips = renderWithRouter(
      <OverviewPanels
        panels={kindPanels(
          [
            group("scout", "product", [
              service("scout", [
                environment("scout/prod", {
                  status: "canceled",
                  request: { deploymentId: "r293", revision: 293 },
                }),
              ]),
            ]),
          ],
          [],
        )}
      />,
    );
    expect(chips).toContain(
      '<a href="/environments/scout/prod" class="overview-chip overview-chip-request">' +
        '<span class="env-name">prod</span>' +
        '<span class="overview-accepted"><span class="revision">r274</span>' +
        '<span class="visually-hidden"> accepted </span>',
    );
    expect(chips).toContain(
      '<span class="status status-canceled"><span class="status-glyph" aria-hidden="true">⊘</span>' +
        '<span class="status-label">r293 canceled</span></span></a>',
    );
    // The accepted release never borrows the request's status.
    expect(chips).not.toContain("r274 canceled");
  });

  it("marks a firing monitor alarm on the accepted release", () => {
    const alarmed = service("arcade", [
      environment("arcade/prod", { alarmedAt: "2026-11-02T00:00:00.000Z" }),
    ]);
    expect(serviceStanding(alarmed)).toBe("alarmed");
    expect(
      serviceStanding(
        service("arcade", [
          environment("arcade/prod", {
            alarmedAt: "2026-11-02T00:00:00.000Z",
            status: "failed",
            recoveryRequired: true,
          }),
        ]),
      ),
    ).toBe("recovery_required");
    expect(
      renderWithRouter(
        <OverviewPanels
          panels={kindPanels([group("arcade", "product", [alarmed])], [])}
        />,
      ),
    ).toContain(
      '<span class="status status-alarmed"><span class="status-glyph" aria-hidden="true">!</span>' +
        '<span class="status-label">alarm firing</span></span>',
    );
  });

  it("draws an arrow only before a stage that promotes from the one beside it", () => {
    expect(html.match(/class="overview-arrow"/gu)).toHaveLength(1);
    expect(html).toContain(
      '<li><span class="overview-arrow" aria-hidden="true">→</span>' +
        '<a href="/environments/scout/prod"',
    );
  });
});

describe("attention panel", () => {
  it("renders nothing when there is nothing to act on", () => {
    expect(renderWithRouter(<AttentionPanel items={[]} />)).toBe("");
  });

  it("keeps its region name and links each item to its target", () => {
    const html = renderWithRouter(
      <AttentionPanel items={[attention("arcade")]} />,
    );
    expect(html).toContain(
      '<section class="panel attention attention-failed" aria-labelledby="attention-heading">',
    );
    expect(html).toContain('<h2 id="attention-heading">Needs attention</h2>');
    expect(html).toContain('<span class="attention-count">1 item</span>');
    expect(html).toContain(
      '<a href="/deployments/arcade-deployment">arcade prod deployment failed</a>',
    );
  });

  it("takes the failure tone for a monitor alarm, the waiting tone for a long queue", () => {
    expect(
      renderWithRouter(
        <AttentionPanel items={[{ ...attention("arcade"), kind: "alarm" }]} />,
      ),
    ).toContain('class="panel attention attention-failed"');
    expect(
      renderWithRouter(
        <AttentionPanel items={[{ ...attention("birmel"), kind: "queued" }]} />,
      ),
    ).toContain('<span class="badge badge-queued">Queued</span>');
  });

  it("takes the waiting tone when every item is an approval", () => {
    expect(
      renderWithRouter(
        <AttentionPanel
          items={[
            { ...attention("arcade"), kind: "approval" },
            {
              ...attention("scout"),
              kind: "approval",
              target: { kind: "deployment", id: "other" },
            },
          ]}
        />,
      ),
    ).toContain('class="panel attention attention-waiting"');
  });
});

describe("overview change keys", () => {
  it("marks the grid stale on any change, through the hub prefix", async () => {
    const client = new QueryClient();
    client.setQueryData(GRID_KEY, { groups: [], attention: [] });
    expect(client.getQueryState(GRID_KEY)?.isInvalidated).toBe(false);
    for (const queryKey of keysForChange({
      id: "a",
      domain: "snapshot",
      action: "snapshot.imported",
      entityId: "s",
    }))
      await client.invalidateQueries({ queryKey });
    expect(client.getQueryState(GRID_KEY)?.isInvalidated).toBe(true);
  });
});
