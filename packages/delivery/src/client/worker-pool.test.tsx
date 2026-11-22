import { describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as fixtures from "#testing/model-fixtures.ts";
import {
  WorkerPoolSnapshotSchema,
  WorkerPoolStateSchema,
  WorkerVersionSchema,
  workerHostSpecification,
} from "#shared/worker-contract.ts";
import { ConfirmDialogProvider } from "#client/components/confirm-dialog.tsx";
import { renderWithRouter } from "#client/test-router.tsx";
import { WorkerPoolPanel, groupWorkers } from "./worker-pool.tsx";

// The hub client resolves its API origin from the page; static rendering has none.
vi.hoisted(() => {
  Object.defineProperty(globalThis, "location", {
    value: new URL("https://delivery.invalid/"),
    configurable: true,
  });
});

const INTRODUCED = "45cf1828-0f01-4bcd-8dab-592769df488f";

/** One Scout production worker build, named by a single hex digit. */
function worker(digit: string, replicas: 0 | 1) {
  const digest = `sha256:${digit.repeat(64)}`;
  return WorkerVersionSchema.parse({
    id: `worker/${digit}`,
    environmentId: fixtures.PROD,
    buildId: digit.repeat(40),
    artifactId: `scout-prod/image/${digit}`,
    artifactBuildId: `artifact-build-${digit}`,
    sourceRevision: digit.repeat(40),
    image: `docker.io/shepherdjerred/scout-for-lol@${digest}`,
    digest,
    introducedByDeploymentId: INTRODUCED,
    host: workerHostSpecification("scout-prod"),
    replicas,
    generation: 1,
    retiredAt: null,
  });
}

const SELECTED = worker("a", 1);
const RETAINED = worker("b", 1);
const VERSIONS = [
  SELECTED,
  RETAINED,
  worker("c", 0),
  worker("d", 0),
  worker("e", 0),
];

/** The deployment whose frozen pool selected build `a`. */
const accepted = fixtures.recordedDeployment({
  id: "scout-prod-42",
  kind: "deploy",
  status: "succeeded",
  revision: 42,
  workerSnapshot: WorkerPoolSnapshotSchema.parse({
    schema: "delivery-worker-pool/v1",
    environmentId: fixtures.PROD,
    environmentGeneration: 12,
    target: "scout-prod",
    candidateBuildId: SELECTED.buildId,
    versions: [SELECTED, RETAINED],
  }),
});

function panel(options: { versions?: typeof VERSIONS; permitted?: boolean }) {
  const client = new QueryClient();
  client.setQueryData(
    ["workers", fixtures.PROD],
    WorkerPoolStateSchema.parse({
      environmentId: fixtures.PROD,
      generation: 12,
      versions: options.versions ?? VERSIONS,
    }),
  );
  return renderWithRouter(
    <QueryClientProvider client={client}>
      <ConfirmDialogProvider>
        <WorkerPoolPanel
          environment={fixtures.environments.prod}
          deployments={[accepted]}
          permitted={options.permitted ?? true}
          onDeployment={() => Promise.resolve()}
        />
      </ConfirmDialogProvider>
    </QueryClientProvider>,
  ).replaceAll("<!-- -->", "");
}

/** Each body row of a rendered worker table. */
function rows(html: string) {
  return html.split("<tbody>").slice(1).join("").split("<tr>").slice(1);
}

describe("retained workers", () => {
  test("lists builds with a desired host and collapses retained artifacts without one", () => {
    const html = panel({});
    // A closed disclosure, labelled with how many artifacts it holds.
    const artifacts = html.indexOf(
      '<details class="disclosure"><summary><span class="disclosure-label">Retained artifacts with no desired host</span><span class="disclosure-count">3</span></summary>',
    );
    expect(artifacts).toBeGreaterThan(-1);
    const hosted = rows(html.slice(0, artifacts));
    const unhosted = rows(html.slice(artifacts));
    expect(hosted).toHaveLength(2);
    expect(hosted[0]).toContain("1 · selected");
    expect(hosted[1]).toContain("1 · retained");
    // Three artifacts that read the same share one row that lists each.
    expect(unhosted).toHaveLength(1);
    const [group = ""] = unhosted;
    expect(group).toContain("<strong>3 builds</strong>");
    expect(group).toContain("Zero · artifacts retained");
    expect(group).not.toContain("Request retirement");
    for (const digit of ["c", "d", "e"])
      expect(group).toContain(`title="${digit.repeat(40)}"`);
    // The collapsed table has no retirement column: nothing there has a host to stop.
    expect(html.slice(artifacts)).not.toContain("<th>Retirement</th>");
    expect(html.slice(0, artifacts)).toContain("<th>Retirement</th>");
  });

  test("a row shows one identifier, its build, and keeps every full identity behind its host line", () => {
    const [, retained = ""] = rows(panel({}));
    const build = "b".repeat(40);
    const digest = `sha256:${"b".repeat(64)}`;
    expect(retained).toContain(
      `<abbr class="mono identifier" title="${build}"><span aria-hidden="true">bbbbbbbbbbbb…</span><span class="visually-hidden">${build}</span></abbr>`,
    );
    expect(retained.match(/<abbr /gu)).toHaveLength(1);
    expect(retained).not.toContain(`title="${digest}"`);
    expect(retained).toContain(
      '<summary><span class="disclosure-label">scout-prod-workflows · prod / scout-prod</span></summary>',
    );
    const provenance = retained.slice(retained.indexOf("worker-provenance"));
    expect(provenance).toContain(
      `<dt>Image</dt><dd class="mono">docker.io/shepherdjerred/scout-for-lol@${digest}</dd>`,
    );
    expect(provenance).toContain(
      `<dt>Build</dt><dd class="mono">${build}</dd>`,
    );
    expect(provenance).toContain(
      '<dt>Artifact</dt><dd class="mono">scout-prod/image/b · build artifact-build-b</dd>',
    );
    expect(provenance).toContain(`href="/deployments/${INTRODUCED}"`);
    expect(provenance).toContain("<dd>scout-prod · scout-prod-workflows</dd>");
    expect(provenance).toContain("prod / scout-prod-workflows / scout-prod");
  });

  test("only a retained build with a host offers retirement, named by its build", () => {
    const [selected = "", retained = ""] = rows(panel({}));
    expect(selected).not.toContain("Request retirement");
    const described = /id="(?<id>[^"]+)"/u.exec(retained)?.groups?.["id"];
    expect(described).toBeDefined();
    expect(retained).toContain(
      `<button type="button" class="secondary-button danger" aria-describedby="${described ?? ""}">Request retirement</button>`,
    );
    expect(panel({ permitted: false })).not.toContain("Request retirement");
  });

  test("a table where no build can be retired has no retirement column, and identical rows fold", () => {
    const retained = ["b", "c", "d"].map((digit) => worker(digit, 1));
    const html = panel({ versions: [SELECTED, ...retained], permitted: false });
    expect(html).not.toContain("<th>Retirement</th>");
    const [selected = "", group = ""] = rows(html);
    expect(rows(html)).toHaveLength(2);
    expect(selected).toContain("1 · selected");
    expect(group).toContain("<strong>3 builds</strong>");
    expect(group).toContain("1 · retained each");
    expect(group).toContain(
      '<span class="disclosure-label">scout-prod-workflows · prod / scout-prod</span><span class="disclosure-count">3</span>',
    );
    expect(group.match(/>Build details</gu)).toHaveLength(3);
  });

  test("builds that offer an action keep rows of their own", () => {
    const retained = ["b", "c"].map((digit) => worker(digit, 1));
    const groups = groupWorkers(
      [SELECTED, ...retained, worker("d", 0), worker("e", 0)],
      SELECTED.buildId,
      (candidate) =>
        candidate.replicas === 1 && candidate.buildId !== SELECTED.buildId,
    );
    expect(groups.map((group) => group.workers.length)).toEqual([1, 1, 1, 2]);
    const passive = groupWorkers(retained, SELECTED.buildId, () => false);
    expect(passive.map((group) => group.workers.length)).toEqual([2]);
  });

  test("retained artifacts with no desired host share one row whichever host they were built for", () => {
    const elsewhere = WorkerVersionSchema.parse({
      ...worker("f", 0),
      host: workerHostSpecification("scout-beta"),
    });
    const groups = groupWorkers(
      [worker("c", 0), elsewhere, worker("d", 0)],
      SELECTED.buildId,
      () => false,
    );
    expect(groups.map((group) => group.workers.length)).toEqual([3]);
    const html = panel({ versions: [SELECTED, worker("c", 0), elsewhere] });
    const [group = ""] = rows(html.slice(html.indexOf("Retained artifacts")));
    expect(group).toContain("<strong>2 builds</strong>");
    expect(group).toContain('<span class="disclosure-label">2 hosts</span>');
    expect(group).toContain("Zero · artifacts retained");
  });

  test("a pool with no desired host says so above its collapsed artifacts", () => {
    const html = panel({ versions: [worker("c", 0)] });
    expect(html).toContain("No worker build has a desired host.");
    expect(html).toContain('<span class="disclosure-count">1</span>');
    expect(rows(html)).toHaveLength(1);
  });

  test("every row asks through the page's one dialog", () => {
    expect(panel({}).match(/<dialog/gu)).toHaveLength(1);
  });
});
