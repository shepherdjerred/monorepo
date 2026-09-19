import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { selectSteps } from "#src/pipeline/select.ts";
import { emitWorkflow, shellQuote, wrapCommands } from "#src/pipeline/emit.ts";
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
