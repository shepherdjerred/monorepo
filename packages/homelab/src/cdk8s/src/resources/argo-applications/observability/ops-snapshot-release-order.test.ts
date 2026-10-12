import { App, Chart } from "cdk8s";
import { expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { applyApplicationReleasePolicy } from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import { createFliptApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/flipt.ts";
import { createTemporalApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/temporal.ts";
import { createTrmnlDashboardApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/trmnl-dashboard.ts";
import { createAlertDashboardApp } from "./alert-dashboard.ts";

const ApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({
    name: z.string(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
});

test("both ops snapshot consumers reconcile before Temporal emits new source contracts", () => {
  const app = new App();
  const chart = new Chart(app, "apps");
  // Construct the producer first: compatibility must follow declarative waves,
  // independently of resource creation order or alphabetical names.
  createTemporalApp(chart);
  createTrmnlDashboardApp(chart);
  createAlertDashboardApp(chart);
  createFliptApp(chart);
  // Exercise the final root policy, which is authoritative over annotations
  // declared by individual Application constructors.
  applyApplicationReleasePolicy(app);
  const applications = parseAllDocuments(app.synthYaml()).map((document) =>
    ApplicationSchema.parse(document.toJS()),
  );
  const wave = (name: string): number => {
    const application = applications.find(
      (item) => item.metadata.name === name,
    );
    if (application === undefined)
      throw new Error(`Missing synthesized Application ${name}`);
    const declared =
      application.metadata.annotations?.["argocd.argoproj.io/sync-wave"] ?? "0";
    return z.coerce.number().int().parse(declared);
  };
  expect(applications).toHaveLength(4);
  for (const consumer of ["alert-dashboard", "trmnl-dashboard"]) {
    expect(wave(consumer)).toBeLessThan(wave("temporal"));
    // The shared flag service precedes consumers; neither consumer requires
    // Temporal or upstream observations to become ready.
    expect(wave("flipt")).toBeLessThanOrEqual(wave(consumer));
  }
});
