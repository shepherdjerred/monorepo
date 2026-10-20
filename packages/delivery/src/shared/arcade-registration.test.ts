import { expect, test } from "vitest";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import {
  PipelineDefinitionSchema,
  RegisterEnvironmentSchema,
} from "./contract.ts";

test("reviewed Arcade registration matches the catalog and published artifact contract", async () => {
  const pipelineInput: unknown = await Bun.file(
    new URL("../../registrations/arcade.pipeline.json", import.meta.url),
  ).json();
  const environmentInput: unknown = await Bun.file(
    new URL("../../registrations/arcade.environment.json", import.meta.url),
  ).json();
  const pipeline = PipelineDefinitionSchema.parse(pipelineInput);
  const environment = RegisterEnvironmentSchema.parse(environmentInput);
  const catalog = new ServiceIndex();
  expect(catalog.byArgoApp(environment.application ?? "")?.id).toBe(
    environment.serviceId,
  );
  expect(pipeline.kind).toBe("argocd");
  if (pipeline.kind !== "argocd")
    throw new Error("Arcade requires ArgoCD reconciliation");
  expect(catalog.byChart(pipeline.chartName)?.id).toBe(environment.serviceId);
  expect(catalog.byImage("arcade")?.id).toBe(environment.serviceId);
  expect(pipeline).toMatchObject({
    application: environment.application,
    chartComponent: "chart:arcade",
    artifactParameters: { "delivery.image": "image:arcade" },
    namespace: "arcade",
    verification: {
      url: "https://arcade.sjer.red/health",
      expectedStatus: 200,
    },
  });
  expect(environment).toMatchObject({
    id: "arcade/prod",
    pipelineRevisionId: "arcade/2",
    automatic: true,
  });
});
