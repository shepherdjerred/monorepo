import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { selectSteps } from "#src/pipeline/select.ts";
import { emitWorkflow, shellQuote, wrapCommands } from "#src/pipeline/emit.ts";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { LIGHT_TIER } from "#src/pipeline/tiers.ts";

function step(key: string, overrides: Partial<CiStep> = {}): CiStep {
  return {
    key,
    label: key,
    image: "ghcr.io/example/ci@sha256:" + "a".repeat(64),
    commands: ["echo hi"],
    timeoutMinutes: 5,
    resources: LIGHT_TIER,
    ...overrides,
  };
}

const CONTEXT = {
  event: "pull_request",
  branch: "feature",
  defaultBranch: "main",
  changedFiles: ["packages/scout-for-lol/src/index.ts"],
};

describe("selection", () => {
  test("keeps a step whose changed-path guard matches", () => {
    const selected = selectSteps(
      [step("scout", { changed: { include: ["packages/scout-for-lol/**"] } })],
      CONTEXT,
    );
    expect(selected.map((s) => s.key)).toEqual(["scout"]);
  });

  test("drops a step whose guard does not match", () => {
    const selected = selectSteps(
      [step("homelab", { changed: { include: ["packages/homelab/**"] } })],
      CONTEXT,
    );
    expect(selected).toEqual([]);
  });

  test("pulls in dependencies of a selected step", () => {
    const selected = selectSteps(
      [
        step("verify"),
        step("deploy", {
          dependsOn: ["verify"],
          changed: { include: ["packages/scout-for-lol/**"] },
        }),
      ],
      CONTEXT,
    );
    expect(selected.map((s) => s.key)).toEqual(["verify", "deploy"]);
  });

  /**
   * The emitted workflows carry `depends_on` and no `when`, so a dependency
   * that was filtered out would leave its dependent permanently unrunnable.
   */
  test("closes over a dependency whose own guard does not match", () => {
    const selected = selectSteps(
      [
        step("build-homelab", {
          changed: { include: ["packages/homelab/**"] },
        }),
        step("deploy", {
          dependsOn: ["build-homelab"],
          changed: { include: ["packages/scout-for-lol/**"] },
        }),
      ],
      CONTEXT,
    );
    expect(selected.map((s) => s.key)).toEqual(["build-homelab", "deploy"]);
  });

  test("runs everything when the changed-file list is empty", () => {
    const selected = selectSteps(
      [step("homelab", { changed: { include: ["packages/homelab/**"] } })],
      { ...CONTEXT, changedFiles: [] },
    );
    expect(selected.map((s) => s.key)).toEqual(["homelab"]);
  });

  test("honours exclude patterns", () => {
    const selected = selectSteps(
      [
        step("docs-only", {
          changed: { include: ["**"], exclude: ["**/*.ts"] },
        }),
      ],
      CONTEXT,
    );
    expect(selected).toEqual([]);
  });

  test("drops a default-branch-only step on a feature branch", () => {
    const selected = selectSteps(
      [step("release", { defaultBranchOnly: true })],
      CONTEXT,
    );
    expect(selected).toEqual([]);
  });

  test("keeps a default-branch-only step on main", () => {
    const selected = selectSteps(
      [step("release", { defaultBranchOnly: true })],
      {
        ...CONTEXT,
        branch: "main",
      },
    );
    expect(selected.map((s) => s.key)).toEqual(["release"]);
  });

  test("rejects an unknown dependency instead of dropping the edge", () => {
    expect(() =>
      selectSteps([step("deploy", { dependsOn: ["missing"] })], CONTEXT),
    ).toThrow(/depends on unknown step missing/u);
  });

  test("rejects a dependency cycle", () => {
    expect(() =>
      selectSteps(
        [step("a", { dependsOn: ["b"] }), step("b", { dependsOn: ["a"] })],
        CONTEXT,
      ),
    ).toThrow(/dependency cycle/u);
  });

  test("rejects duplicate step keys", () => {
    expect(() => selectSteps([step("a"), step("a")], CONTEXT)).toThrow(
      /duplicate step key/u,
    );
  });
});

describe("emission", () => {
  test("bounds each attempt with a timeout", () => {
    const [command] = wrapCommands(step("a", { timeoutMinutes: 3 }));
    expect(command).toContain("timeout 180s");
  });

  test("retries wrap the timeout, not the other way round", () => {
    const [command] = wrapCommands(
      step("a", { timeoutMinutes: 2, retries: 3 }),
    );
    expect(command).toContain("seq 1 3");
    // Each attempt gets its own budget; a hung attempt cannot eat the rest.
    expect(command).toContain("timeout 120s");
  });

  test("quotes commands so embedded quotes survive", () => {
    expect(shellQuote("it's fine")).toBe(String.raw`'it'\''s fine'`);
  });

  test("renders per-step pod spec, grants, and dependencies", () => {
    const yaml = emitWorkflow(
      step("verify", {
        dependsOn: ["lint"],
        secrets: [
          { secret: "ci-github-credentials", key: "TOKEN", env: "GH_TOKEN" },
        ],
        volumes: [{ claim: "woodpecker-bun-cache", path: "/cache" }],
        concurrency: { limit: 1, group: "release" },
      }),
    );
    const parsed: unknown = parse(yaml);
    expect(parsed).toMatchObject({
      depends_on: ["lint"],
      concurrency: { limit: 1, group: "release" },
      steps: [
        {
          name: "verify",
          volumes: ["woodpecker-bun-cache:/cache"],
          backend_options: {
            kubernetes: {
              serviceAccountName: "woodpecker-job",
              nodeSelector: { "kubernetes.io/hostname": "liskov" },
              secrets: [
                {
                  name: "ci-github-credentials",
                  key: "TOKEN",
                  target: { env: "GH_TOKEN" },
                },
              ],
            },
          },
        },
      ],
    });
  });

  test("carries ephemeral-storage bounds the node quota counts", () => {
    const parsed: unknown = parse(emitWorkflow(step("a")));
    expect(parsed).toMatchObject({
      steps: [
        {
          backend_options: {
            kubernetes: {
              resources: {
                requests: {
                  "ephemeral-storage": LIGHT_TIER.ephemeralStorageRequest,
                },
                limits: {
                  "ephemeral-storage": LIGHT_TIER.ephemeralStorageLimit,
                },
              },
            },
          },
        },
      ],
    });
  });

  /** Double-filtering would strand a dependent on a skipped workflow. */
  test("emits no when clause — selection already decided", () => {
    const parsed: unknown = parse(
      emitWorkflow(step("a", { changed: { include: ["**"] } })),
    );
    expect(parsed).not.toHaveProperty("when");
  });
});

describe("ported lanes", () => {
  const IMAGES = {
    base: "ghcr.io/shepherdjerred/ci-base@sha256:" + "a".repeat(64),
    playwright: "ghcr.io/shepherdjerred/ci-playwright@sha256:" + "b".repeat(64),
    catalog: {
      "aquasec/trivy": "aquasec/trivy:0.72.0",
      "semgrep/semgrep": "semgrep/semgrep:1.170.0",
      "texlive/texlive": "texlive/texlive:TL2024-historic",
      "trmnl/trmnlp": "trmnl/trmnlp:v0.11.0",
      "grafana/tempo": "grafana/tempo:3.0.3",
      "mikefarah/yq": "mikefarah/yq:latest",
      "minio/mc": "minio/mc:RELEASE",
      "minio/minio": "minio/minio:RELEASE",
    },
  };

  function keysFor(changedFiles: string[], branch = "feature") {
    return selectSteps(
      buildPipelineSteps({ images: IMAGES, changedBase: "x" }),
      {
        event: branch === "main" ? "push" : "pull_request",
        branch,
        defaultBranch: "main",
        changedFiles,
      },
    ).map((s) => s.key);
  }

  test("a lockfile change selects the scanners", () => {
    expect(keysFor(["bun.lock"])).toContain("trivy");
  });

  test("a docs-only change selects neither scanner", () => {
    const keys = keysFor(["packages/docs/wiki/src/content/docs/index.md"]);
    expect(keys).not.toContain("trivy");
    expect(keys).not.toContain("semgrep");
  });

  /**
   * A change to the generator itself must not be filtered out by any lane's
   * narrower guard — the thing deciding what runs changed.
   */
  test("a change to the generator selects every lane", () => {
    const keys = keysFor([
      "packages/woodpecker-config-extension/src/pipeline/steps.ts",
    ]);
    expect(keys).toEqual(
      expect.arrayContaining([
        "verify",
        "trivy",
        "semgrep",
        "alert-dashboard-sqlite",
      ]),
    );
  });

  test("scanners are pull-request only", () => {
    expect(keysFor(["bun.lock"], "main")).not.toContain("trivy");
  });

  /**
   * Buildkite needed a -pr and a -main step because the main variant carried a
   * precomputed metadata gate. Selection now happens before generation, so one
   * step covers both events.
   */
  test("the resume lane is one step covering both events", () => {
    expect(keysFor(["packages/resume/resume.tex"])).toContain("resume-build");
    expect(keysFor(["packages/resume/resume.tex"], "main")).toContain(
      "resume-build",
    );
    const steps = buildPipelineSteps({ images: IMAGES, changedBase: "x" });
    expect(steps.filter((s) => s.key.startsWith("resume"))).toHaveLength(1);
  });

  test("alert dashboard runs for its own package", () => {
    expect(keysFor(["packages/alert-dashboard/src/db.ts"])).toContain(
      "alert-dashboard-sqlite",
    );
  });

  /** Findings must exit 0; a crashed scanner must still propagate. */
  test("scanner commands distinguish findings from a crash", () => {
    const steps = buildPipelineSteps({ images: IMAGES, changedBase: "x" });
    const trivy = steps.find((s) => s.key === "trivy");
    const joined = trivy?.commands.join("\n") ?? "";
    expect(joined).toContain("-eq 7");
    expect(joined).toContain("exit 0");
    expect(joined).toContain('exit "$trivy_status"');
    expect(trivy?.allowFailure).toBeUndefined();
  });
});
