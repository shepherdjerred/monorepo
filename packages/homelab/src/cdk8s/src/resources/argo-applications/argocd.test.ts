import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Testing } from "cdk8s";
import { stringify } from "yaml";
import { z } from "zod";
import { ARGO_APPLICATION_HEALTH_LUA, createArgoCdApp } from "./argocd.ts";

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
        // Synced and Healthy do not resolve a failure on the revision under
        // release: a failed hook leaves both in place, and treating that as
        // healthy would let the root advance to later waves.
        name: "unresolved same-revision failure behind healthy state",
        expected: "Degraded",
        status: {
          sync: { status: "Synced", revision: "new" },
          health: { status: "Healthy" },
          operationState: { phase: "Failed", syncResult: { revision: "new" } },
        },
      },
      {
        name: "failure without a recorded operation revision",
        expected: "Degraded",
        status: {
          sync: { status: "Synced", revision: "new" },
          health: { status: "Healthy" },
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

  it("ignores terminal operation failures on applications that have converged", () => {
    const application = synthArgoCdApplication();
    const customization =
      application.spec.source.helm.valuesObject.configs.cm[
        "resource.customizations.health.argoproj.io_Application"
      ];

    // ArgoCD only re-runs a sync for an application it still sees as OutOfSync,
    // so a failure recorded against an application that later reached
    // Synced+Healthy can never clear. Blocking on it wedges every root health
    // wave behind a child that has nothing left to converge.
    expect(customization).toContain('obj.status.sync.status == "Synced" and');
    expect(customization).toContain(
      'obj.status.health.status == "Healthy" then',
    );

    const convergedClause = customization.slice(
      customization.indexOf('obj.status.sync.status == "Synced" and'),
    );
    expect(convergedClause).toContain("operationBlocks = false");

    // The carve-out must stay scoped to terminal phases: a Running operation is
    // an in-flight child sync the root health wave still has to wait for.
    expect(
      customization.match(/if \(phase == "Failed" or phase == "Error"\) and/g),
    ).toHaveLength(2);
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
