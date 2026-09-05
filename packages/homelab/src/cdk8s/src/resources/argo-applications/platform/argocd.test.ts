import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Testing } from "cdk8s";
import { stringify } from "yaml";
import { z } from "zod";
import { ARGO_APPLICATION_HEALTH_LUA, createArgoCdApp } from "./argocd.ts";

vi.setConfig({ testTimeout: 15_000 });

const ApplicationSchema = z
  .object({
    kind: z.literal("Application"),
    metadata: z.object({
      name: z.literal("argocd"),
    }),
    spec: z.object({
      source: z.object({
        helm: z.object({
          valuesObject: z.object({
            configs: z.object({
              cm: z.object({
                "resource.customizations.health.cert-manager.io_Certificate":
                  z.string(),
                "resource.customizations.health.argoproj.io_Application":
                  z.string(),
              }),
              rbac: z.object({
                "policy.csv": z.string(),
              }),
            }),
          }),
        }),
      }),
    }),
  })
  .loose();

function synthArgoCdApplication() {
  const chart = Testing.chart();
  createArgoCdApp(chart);
  const application = z
    .array(z.unknown())
    .parse(Testing.synth(chart))
    .find((manifest) => ApplicationSchema.safeParse(manifest).success);
  return ApplicationSchema.parse(application);
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function evaluateApplicationHealth(status: unknown): Promise<string> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "argocd-application-health-"),
  );
  temporaryDirectories.push(directory);
  const configPath = path.join(directory, "argocd-cm.yaml");
  const resourcePath = path.join(directory, "application.yaml");
  await Promise.all([
    Bun.write(
      configPath,
      stringify({
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "argocd-cm", namespace: "argocd" },
        data: {
          "resource.customizations.health.argoproj.io_Application":
            ARGO_APPLICATION_HEALTH_LUA,
        },
      }),
    ),
    Bun.write(
      resourcePath,
      stringify({
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "fixture", namespace: "argocd" },
        status,
      }),
    ),
  ]);
  const process = Bun.spawn(
    [
      "argocd",
      "admin",
      "settings",
      "resource-overrides",
      "health",
      resourcePath,
      "--argocd-cm-path",
      configPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`ArgoCD Lua health evaluation failed: ${stderr}`);
  }
  return stdout;
}

describe("ArgoCD application", () => {
  it("grants the Buildkite release step only its required application access", () => {
    const application = synthArgoCdApplication();

    expect(
      application.spec.source.helm.valuesObject.configs.rbac[
        "policy.csv"
      ].split("\n"),
    ).toEqual([
      "p, buildkite, applications, sync, default/*, allow",
      "p, buildkite, applications, get, default/*, allow",
      "p, buildkite, applications, override, default/apps, allow",
    ]);
  });

  it("installs the executable Application health customization", () => {
    const application = synthArgoCdApplication();
    expect(
      application.spec.source.helm.valuesObject.configs.cm[
        "resource.customizations.health.argoproj.io_Application"
      ],
    ).toBe(ARGO_APPLICATION_HEALTH_LUA);
  });

  it("evaluates child state with current health and terminal failures", async () => {
    const fixtures = [
      {
        name: "active operation",
        expected: "Progressing",
        status: {
          sync: { status: "Synced", revision: "new" },
          health: { status: "Healthy" },
          operationState: { phase: "Running", syncResult: { revision: "new" } },
        },
      },
      {
        name: "terminating operation",
        expected: "Progressing",
        status: {
          sync: { status: "Synced", revision: "new" },
          health: { status: "Healthy" },
          operationState: {
            phase: "Terminating",
            syncResult: { revision: "new" },
          },
        },
      },
      {
        name: "unresolved failed operation",
        expected: "Degraded",
        status: {
          sync: { status: "OutOfSync", revision: "new" },
          health: { status: "Healthy" },
          operationState: { phase: "Failed", syncResult: { revision: "new" } },
        },
      },
      {
        name: "resolved stale failure",
        expected: "Healthy",
        status: {
          sync: { status: "Synced", revision: "new" },
          health: { status: "Healthy" },
          operationState: { phase: "Failed", syncResult: { revision: "old" } },
        },
      },
      {
        // ArgoCD never re-syncs an application it already considers Synced, so
        // this failure can never clear on its own. Blocking would wedge every
        // later root wave behind a child with nothing left to converge. The CI
        // release gate still refuses this state — see
        // operationIsReadyForCurrentRevision — so a failed hook on the revision
        // under release stops the release without stranding the cluster.
        name: "same-revision failure on a converged application",
        expected: "Healthy",
        status: {
          sync: { status: "Synced", revision: "new" },
          health: { status: "Healthy" },
          operationState: { phase: "Failed", syncResult: { revision: "new" } },
        },
      },
      {
        // No recorded revision means the failure cannot be shown to be
        // superseded, so convergence is the only thing that can excuse it.
        name: "failure without a recorded operation revision, converged",
        expected: "Healthy",
        status: {
          sync: { status: "Synced", revision: "new" },
          health: { status: "Healthy" },
          operationState: { phase: "Failed" },
        },
      },
      {
        name: "failure without a recorded operation revision, not converged",
        expected: "Degraded",
        status: {
          sync: { status: "Synced", revision: "new" },
          health: { status: "Degraded" },
          operationState: { phase: "Failed" },
        },
      },
      {
        name: "comparison error",
        expected: "Degraded",
        status: {
          sync: { status: "Unknown" },
          health: { status: "Healthy" },
          conditions: [
            { type: "ComparisonError", message: "manifest generation failed" },
          ],
        },
      },
      {
        name: "ordinary drift",
        expected: "Progressing",
        status: {
          sync: { status: "OutOfSync", revision: "new" },
          health: { status: "Degraded" },
        },
      },
      {
        name: "synced unhealthy child",
        expected: "Degraded",
        status: {
          sync: { status: "Synced", revision: "new" },
          health: { status: "Degraded", message: "workload failed" },
        },
      },
    ];

    for (const fixture of fixtures) {
      const output = await evaluateApplicationHealth(fixture.status);
      expect(output, fixture.name).toContain(fixture.expected);
    }
  });

  // Asserted through the evaluator rather than by matching the Lua source: the
  // rule is what the customization decides, and a source match breaks on any
  // rewrite that preserves the behaviour — as this one did.
  it("ignores terminal operation failures on applications that have converged", async () => {
    const converged = await evaluateApplicationHealth({
      sync: { status: "Synced", revision: "new" },
      health: { status: "Healthy" },
      operationState: { phase: "Failed", syncResult: { revision: "new" } },
    });
    expect(converged).toContain("Healthy");

    // The carve-out must stay scoped to terminal phases: a Running operation is
    // an in-flight child sync the root health wave still has to wait for, even
    // though this state is otherwise Synced and Healthy.
    const running = await evaluateApplicationHealth({
      sync: { status: "Synced", revision: "new" },
      health: { status: "Healthy" },
      operationState: { phase: "Running", syncResult: { revision: "new" } },
    });
    expect(running).toContain("Progressing");

    // And a child that has not converged still blocks, so a rejected apply is
    // not swept up by the same carve-out.
    const stillBroken = await evaluateApplicationHealth({
      sync: { status: "OutOfSync", revision: "new" },
      health: { status: "Healthy" },
      operationState: { phase: "Failed", syncResult: { revision: "new" } },
    });
    expect(stillBroken).toContain("Degraded");
  });

  it("keeps only non-failed cert-manager secret issuance progressing", () => {
    const application = synthArgoCdApplication();
    const customization =
      application.spec.source.helm.valuesObject.configs.cm[
        "resource.customizations.health.cert-manager.io_Certificate"
      ];

    expect(customization).toContain('condition.type == "Issuing" and');
    expect(customization).toContain('condition.reason ~= "Issued"');
    expect(customization).toContain(
      'ready.status == "False" and ready.reason ~= "DoesNotExist"',
    );
    expect(customization).toContain("if failedIssuing ~= nil then");
    expect(customization).toContain("hs.message = failedIssuing.message");
    expect(customization.indexOf("if failedIssuing ~= nil then")).toBeLessThan(
      customization.indexOf(
        'ready.status == "False" and ready.reason ~= "DoesNotExist"',
      ),
    );
    expect(customization).toContain('hs.status = "Progressing"');
    expect(customization).toContain('hs.status = "Healthy"');
    expect(customization).toContain('hs.status = "Degraded"');
  });
});
