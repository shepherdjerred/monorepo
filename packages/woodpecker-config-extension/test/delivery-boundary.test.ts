import { expect, test } from "vitest";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import { selectSteps } from "#src/pipeline/select.ts";
import { TEST_IMAGES } from "./identity.ts";

const steps = () =>
  buildPipelineSteps({
    images: TEST_IMAGES,
    changedBase: "base",
    deliveryPublication: true,
  });
const removedSteps = [
  "homelab-release-admission",
  "argocd-sync",
  "version-commit-back",
  "scout-beta-release",
  "scout-tag-release",
  "scout-prod-reconcile",
];
const deploymentSecrets = [
  "ARGOCD_AUTH_TOKEN",
  "ARGOCD_TOKEN",
  "DELIVERY_ADMIN_TOKEN",
  "DELIVERY_EXECUTOR_TOKEN",
  "SEAWEEDFS_SITES_ACCESS_KEY_ID",
  "SEAWEEDFS_SITES_SECRET_ACCESS_KEY",
  "SEAWEEDFS_TOFU_STATE_ACCESS_KEY_ID",
  "SEAWEEDFS_TOFU_STATE_SECRET_ACCESS_KEY",
  "SEAWEEDFS_TOFU_ADMIN_ACCESS_KEY_ID",
  "SEAWEEDFS_TOFU_ADMIN_SECRET_ACCESS_KEY",
  "TAILSCALE_OAUTH_CLIENT_ID",
  "TAILSCALE_OAUTH_CLIENT_SECRET",
  "CLOUDFLARE_API_TOKEN",
  "TOFU_GITHUB_TOKEN",
  "RADARR_API_KEY",
  "SONARR_API_KEY",
  "PROWLARR_API_KEY",
  "QBITTORRENT_PASSWORD",
  "TRMNL_API_KEY",
];

test.each([false, true])(
  "the complete CI graph has no deployment execution or authority (catalog=%s)",
  (deliveryPublication) => {
    const graph = buildPipelineSteps({
      images: TEST_IMAGES,
      changedBase: "base",
      deliveryPublication,
    });
    expect(graph.length).toBeGreaterThan(15);
    for (const step of graph) {
      expect(removedSteps).not.toContain(step.key);
      expect(step.key).not.toMatch(/^tofu-(?:apply|platform|plan)-/u);
      for (const credential of step.secrets ?? [])
        expect(
          deploymentSecrets,
          `${step.key}/${credential.env}`,
        ).not.toContain(credential.env);
      const commands = step.commands.join("\n");
      expect(commands).not.toMatch(
        /argocd\.ts\s+(?:release-root|suspend-auto-sync)|homelab-release-admission\.ts|update-versions\.ts|legacy-platform-owner\.ts|--commit-back/u,
      );
      expect(commands).not.toMatch(
        /scout-site-release\.ts\s+(?:deploy-beta|reconcile-prod|reconcile-prod-pin|tag-release)(?:\s|$)/u,
      );
      expect(commands).not.toMatch(
        /tofu-stack\.ts[^\n]+\s(?:apply|apply-saved|prepare|plan)(?:\s|$)/u,
      );
    }
  },
);

test("static and Scout producers always publish immutable archives, independently of API bootstrap", () => {
  const graph = buildPipelineSteps({
    images: TEST_IMAGES,
    changedBase: "base",
  });
  expect(graph.some((step) => step.key === "delivery-publish")).toBe(false);
  for (const key of ["sites", "scout-site-archives"]) {
    const producer = graph.find((step) => step.key === key);
    expect(producer?.defaultBranchOnly).toBe(true);
    expect(
      producer?.secrets
        ?.filter((grant) => grant.secret === "ci-delivery-archive-credentials")
        .map((grant) => grant.env),
    ).toEqual([
      "DELIVERY_ARCHIVE_PUBLISHER_ACCESS_KEY_ID",
      "DELIVERY_ARCHIVE_PUBLISHER_SECRET_ACCESS_KEY",
    ]);
  }
  expect(
    graph.find((step) => step.key === "sites")?.commands.join("\n"),
  ).toContain("deploy-site.ts sjer.red --prebuilt --archive");
  expect(
    graph.find((step) => step.key === "sites")?.commands.join("\n"),
  ).toContain("write-site-archive-handoff.ts");
  expect(
    graph
      .find((step) => step.key === "scout-site-archives")
      ?.commands.join("\n"),
  ).toContain("publish-scout-site-archives.ts");
});

test("artifact publication preserves build gates and has no deployment-acceptance dependency", () => {
  const graph = steps();
  const imageProducer = graph.find((step) => step.key === "images");
  expect(imageProducer?.defaultBranchOnly).toBe(true);
  expect(imageProducer?.environment?.["DELIVERY_URL"]).toBe(
    "http://delivery.delivery.svc.cluster.local:7353",
  );
  expect(
    imageProducer?.secrets?.filter(
      (grant) => grant.secret === "ci-delivery-credentials",
    ),
  ).toEqual([
    {
      secret: "ci-delivery-credentials",
      key: "DELIVERY_PUBLISHER_TOKEN",
      env: "DELIVERY_API_TOKEN",
    },
  ]);
  expect(graph.find((step) => step.key === "images")?.dependsOn).toEqual([
    "verify",
  ]);
  const charts = graph.find((step) => step.key === "helm-push");
  expect(charts?.dependsOn).toEqual([
    "images",
    "ci-base-refresh",
    "ci-playwright-refresh",
  ]);
  expect(charts?.commands).toContain(
    'bun --no-install packages/homelab/scripts/helm/helm-push.ts "$CI_RELEASE_NUMBER" --delivery-catalog',
  );
  expect(charts?.commands.join("\n")).toContain("delivery-chart-publications");
  const publication = graph.find((step) => step.key === "delivery-publish");
  expect(publication?.dependsOn).toEqual(
    expect.arrayContaining([
      "verify",
      "images",
      "helm-push",
      "sites",
      "scout-site-archives",
      "trmnl-plugin-archives",
    ]),
  );
  expect(publication?.commands).toContain(
    "bun --no-install scripts/ci/publish-delivery.ts --static-archives",
  );
  expect(
    publication?.secrets?.filter(
      (grant) => grant.secret === "ci-delivery-credentials",
    ),
  ).toEqual([
    {
      secret: "ci-delivery-credentials",
      key: "DELIVERY_PUBLISHER_TOKEN",
      env: "DELIVERY_API_TOKEN",
    },
  ]);
  expect(publication?.defaultBranchOnly).toBe(true);
});

test.each([false, true])(
  "chart publication checks fresh content-unchanged Storm artifacts (fresh=%s)",
  async (fresh) => {
    const chart = steps().find((step) => step.key === "helm-push");
    if (chart === undefined) throw new Error("Helm producer missing");
    const gateEnd = chart.commands.findIndex((command) =>
      command.startsWith("MISE_TOOLCHAIN_SCOPE="),
    );
    expect(gateEnd).toBeGreaterThan(1);
    const child = Bun.spawn(
      [
        "bash",
        "-eu",
        "-c",
        [
          'bun() { case "$2" in',
          'scripts/ci/read-ci-handoff.ts) if [ "$3" = delivery-image-digests ]; then printf "%s" "$FRESH_IMAGE_DIGESTS"; else printf "{}"; fi ;;',
          "ci/scripts/selectors/ci-changed.ts) return 1 ;;",
          "*) return 2 ;; esac; }",
          ...chart.commands.slice(1, gateEnd),
          String.raw`printf 'helm-publication-requested\n'`,
        ].join("\n"),
      ],
      {
        env: {
          FRESH_IMAGE_DIGESTS: JSON.stringify(
            fresh
              ? {
                  "shepherdjerred/the-storm-server": `sha256:${"a".repeat(64)}`,
                }
              : {},
          ),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [status, output, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(error).toBe("");
    expect(status).toBe(0);
    expect(output).toBe(fresh ? "helm-publication-requested\n" : "");
  },
);

test("every emitted dependency exists and the full graph is acyclic", () => {
  const graph = steps();
  const selected = selectSteps(graph, {
    event: "push",
    branch: "main",
    defaultBranch: "main",
    changedFiles: [],
  });
  expect(selected.length).toBeGreaterThan(10);
  expect(new Set(graph.map((step) => step.key)).size).toBe(graph.length);
});

test("toolchain pin builds retain all real artifact producer dependencies and register provenance", () => {
  const graph = steps();
  expect(graph.map((step) => step.key)).toEqual(
    expect.arrayContaining([
      "verify",
      "images",
      "helm-push",
      "sites",
      "scout-site-archives",
      "delivery-publish",
    ]),
  );
  const keys = new Set(graph.map((step) => step.key));
  for (const step of graph)
    for (const dependency of step.dependsOn ?? [])
      expect(keys.has(dependency), `${step.key}/${dependency}`).toBe(true);
});

test("PR verification cannot select any artifact publisher", () => {
  const selected = selectSteps(steps(), {
    event: "pull_request",
    branch: "main",
    defaultBranch: "main",
    changedFiles: [],
  });
  for (const key of [
    "images",
    "helm-push",
    "sites",
    "scout-site-archives",
    "delivery-publish",
    "trmnl-plugin-archives",
    "publish",
  ])
    expect(selected.some((step) => step.key === key)).toBe(false);
  expect(selected.some((step) => step.key === "verify")).toBe(true);
  expect(selected.some((step) => step.key === "tofu-validate")).toBe(true);
});
