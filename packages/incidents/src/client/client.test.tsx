import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  BROWSER_ACTOR,
  IncidentsApiError,
  mutateIncident,
} from "#client/api.ts";
import { CommandPanel, type RunCommand } from "#client/detail-command.tsx";
import { declareInput, DuplicateNotice } from "#client/declare-page.tsx";
import { HomeCardView } from "#client/home-card.tsx";
import { incidentsPaletteSearch } from "#client/hub-client.tsx";
import { IncidentTable, listFilter } from "#client/list-page.tsx";
import {
  actorRecord,
  detail,
  dispatching,
  FIXER,
  NOW_MS,
  owned,
  summary,
  unowned,
  VIEWER_KEY,
} from "#client/test-records.ts";
import { errorMessage } from "#client/ui.tsx";

const render = (node: ReactNode): string =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

const unusedRun: RunCommand = () =>
  Promise.reject(new Error("static renders never run commands"));

function trpcResponse(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("incident list", () => {
  it("shows id, severity, status, systems, command, signals, affected, and age per row", () => {
    const html = render(
      <IncidentTable
        captionId="caption"
        nowMs={NOW_MS}
        incidents={[
          summary({
            command: dispatching(60),
            firingSignals: 1,
            affectedCount: 2,
          }),
          summary({
            number: 3,
            title: "main is red",
            severity: "sev2",
            status: "identified",
            systems: ["main-ci"],
            command: owned(FIXER),
          }),
        ]}
      />,
    );
    expect(html).toContain("INC-4");
    expect(html).toContain("SEV1");
    expect(html).toContain("Investigating");
    expect(html).toContain("Delivery");
    expect(html).toContain("Dispatching to new session until");
    expect(html).toContain('href="/incidents/INC-3"');
    expect(html).toContain("Owned by claude-code · temporal-schedule-split");
    expect(html).toContain("25m");
    expect(html).toContain('data-label="Firing signals"');
  });

  it("says so when nothing matches", () => {
    expect(
      render(<IncidentTable captionId="c" nowMs={NOW_MS} incidents={[]} />),
    ).toContain("No incidents match these filters.");
  });

  it("layers valid search params over the view's filter and ignores unknown values", () => {
    expect(listFilter("open", new URLSearchParams("system=delivery"))).toEqual({
      state: "open",
      limit: 200,
      system: "delivery",
    });
    expect(
      listFilter(
        "history",
        new URLSearchParams("kind=maintenance&system=nope"),
      ),
    ).toEqual({ state: "resolved", limit: 200, kind: "maintenance" });
  });
});

const ignoreNotice = (): void => {
  // Static renders never report.
};

function panelFor(command: Parameters<typeof detail>[0]): string {
  return render(
    <CommandPanel
      incident={detail(command)}
      actor={BROWSER_ACTOR}
      nowMs={NOW_MS}
      run={unusedRun}
      report={ignoreNotice}
    />,
  );
}

describe("command panel", () => {
  it("offers Take when the incident is unowned and eligible", () => {
    const html = panelFor({ command: unowned(-1) });
    expect(html).toContain("Unowned — takeover eligible now");
    expect(html).toContain("Take command");
    expect(html).not.toContain("Force take");
  });

  it("offers only Force take before the grace ends", () => {
    const html = panelFor({ command: unowned(8) });
    expect(html).toContain("Unowned — takeover eligible at");
    expect(html).not.toContain("Take command</button>");
    expect(html).toContain("Force take");
  });

  it("shows the dispatch lease and lets the viewer force past it", () => {
    const html = panelFor({ command: dispatching(45) });
    expect(html).toContain("Dispatching to new session until");
    expect(html).toContain("Lease held by codex · media-acquisition");
    expect(html).toContain("Force take");
  });

  it("gives the commander Hand off and Release", () => {
    const html = panelFor({
      command: owned(actorRecord(VIEWER_KEY, { name: "Hub browser" })),
    });
    expect(html).toContain("Owned by Hub browser");
    expect(html).toContain("Hand off");
    expect(html).toContain("Release");
    expect(html).not.toContain("Force take");
  });
});

describe("declare", () => {
  const duplicatePayload = {
    error: {
      message: "INC-4 already covers delivery",
      code: -32_009,
      data: {
        code: "CONFLICT",
        httpStatus: 409,
        path: "declare",
        incident: {
          code: "duplicate-incident",
          existing: summary({ command: dispatching(30) }),
          systems: ["delivery"],
        },
      },
    },
  };

  it("surfaces a duplicate declaration as a typed conflict naming the existing incident", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(trpcResponse(409, duplicatePayload)),
    );
    vi.stubGlobal("fetch", fetch);
    const declared = mutateIncident("declare", {
      actor: BROWSER_ACTOR,
      title: "Delivery is stuck",
      systems: ["delivery"],
      exitCondition: "Deployments dispatch.",
    });
    await expect(declared).rejects.toMatchObject({
      name: "IncidentsApiError",
      code: "CONFLICT",
      status: 409,
      conflict: {
        code: "duplicate-incident",
        existing: { identifier: "INC-4" },
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/incidents/trpc/declare",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("offers to join the existing incident instead", () => {
    const html = render(
      <DuplicateNotice
        duplicate={{
          code: "duplicate-incident",
          existing: summary({ command: dispatching(30) }),
          systems: ["delivery"],
        }}
        nowMs={NOW_MS}
        pending={false}
        onJoin={ignoreNotice}
      />,
    );
    expect(html).toContain("INC-4 already covers Delivery");
    expect(html).toContain("Join it instead");
    expect(html).toContain('href="/incidents/INC-4"');
  });

  it("builds the declare input from the form, keeping the window only for maintenance", () => {
    const form = new FormData();
    form.set("kind", "incident");
    form.set("title", "  Delivery is stuck ");
    form.set("severity", "sev1");
    form.append("systems", "delivery");
    form.append("systems", "argocd");
    form.set("components", "temporal-workers, , delivery-api");
    form.set("exitCondition", "Deployments dispatch.");
    form.set("scheduledStart", "2026-11-26T09:00");
    form.set("takeCommand", "on");
    expect(declareInput(form, BROWSER_ACTOR)).toEqual({
      actor: BROWSER_ACTOR,
      kind: "incident",
      title: "Delivery is stuck",
      severity: "sev1",
      systems: ["delivery", "argocd"],
      components: ["temporal-workers", "delivery-api"],
      exitCondition: "Deployments dispatch.",
      takeCommand: true,
    });
    form.set("kind", "maintenance");
    expect(declareInput(form, BROWSER_ACTOR).scheduledStart).toBe(
      new Date("2026-11-26T09:00").toISOString(),
    );
  });
});

describe("conflicts and Home", () => {
  it("explains a stale revision after the page refetches", () => {
    const error = new IncidentsApiError("Revision moved", "CONFLICT", 409, {
      code: "stale-revision",
      expectedRevision: 3,
      incident: summary({ revision: 5 }),
    });
    expect(errorMessage(error)).toBe(
      "INC-4 changed while you were working (now revision 5). The latest version is loaded; check it and try again.",
    );
  });

  it("lists open incidents and maintenance separately, and is calm when nothing is open", () => {
    expect(render(<HomeCardView incidents={[]} nowMs={NOW_MS} />)).toContain(
      "No open incidents.",
    );
    const html = render(
      <HomeCardView
        nowMs={NOW_MS}
        incidents={[
          summary({
            number: 2,
            kind: "maintenance",
            status: "scheduled",
            severity: "sev3",
            title: "PostgreSQL minor upgrade",
            scheduledStart: "2026-11-25T14:00:00.000Z",
          }),
          summary({ number: 5, severity: "sev2", title: "Grafana down" }),
          summary({ number: 4, severity: "sev1" }),
        ]}
      />,
    );
    expect(html.indexOf("INC-4")).toBeLessThan(html.indexOf("INC-5"));
    expect(html.indexOf("Maintenance windows")).toBeLessThan(
      html.indexOf("INC-2"),
    );
    expect(html.indexOf("INC-5")).toBeLessThan(
      html.indexOf("Maintenance windows"),
    );
  });

  it("finds incidents for the palette by INC id or title", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          trpcResponse(200, {
            result: {
              data: [
                summary(),
                summary({ number: 7, title: "Grafana is down" }),
              ],
            },
          }),
        ),
      ),
    );
    const signal = new AbortController().signal;
    expect(await incidentsPaletteSearch("inc-4", signal)).toEqual([
      expect.objectContaining({ to: "/incidents/INC-4", group: "Incidents" }),
    ]);
    const grafana = await incidentsPaletteSearch("grafana", signal);
    expect(grafana.map((result) => result.to)).toEqual(["/incidents/INC-7"]);
    expect(await incidentsPaletteSearch("INC-99", signal)).toEqual([
      expect.objectContaining({
        label: "Open INC-99",
        to: "/incidents/INC-99",
      }),
    ]);
  });
});
