import { expect, test } from "vitest";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import {
  PipelineDefinitionSchema,
  RegisterEnvironmentSchema,
} from "./contract.ts";

test("reviewed registration pairs use canonical services, image owners and promotion environments", async () => {
  const root = new URL("../../registrations/", import.meta.url);
  const files = [
    "arcade.pipeline.json",
    ...new Bun.Glob("**/pipeline.json").scanSync({
      cwd: root.pathname,
      onlyFiles: true,
    }),
  ].toSorted();
  const catalog = new ServiceIndex();
  const definitions = await Promise.all(
    files.map(async (file) => ({
      file,
      pipeline: PipelineDefinitionSchema.parse(
        await Bun.file(new URL(file, root)).json(),
      ),
      environment: RegisterEnvironmentSchema.parse(
        await Bun.file(
          new URL(file.replace(/pipeline\.json$/u, "environment.json"), root),
        ).json(),
      ),
    })),
  );
  const environments = new Map(
    definitions.map((row) => [row.environment.id, row.environment]),
  );
  expect(environments.size).toBe(definitions.length);
  expect(definitions.length).toBeGreaterThan(20);
  for (const { file, pipeline, environment } of definitions) {
    expect(catalog.byId(environment.serviceId)?.id, file).toBe(
      environment.serviceId,
    );
    if (pipeline.kind === "argocd") {
      expect(pipeline.application, file).toBe(environment.application);
      expect(catalog.byChart(pipeline.chartName)?.id, file).toBe(
        environment.serviceId,
      );
      expect(pipeline.chartComponent, file).toBe(`chart:${pipeline.chartName}`);
      for (const component of Object.values(pipeline.artifactParameters)) {
        expect(component.startsWith("image:"), file).toBe(true);
        expect(
          catalog.byImage(component.slice("image:".length))?.id,
          file,
        ).toBe(environment.serviceId);
      }
      if (pipeline.workerRollout !== undefined)
        expect(Object.values(pipeline.artifactParameters), file).toContain(
          pipeline.workerRollout.imageComponent,
        );
    } else if (pipeline.kind === "static-site") {
      expect(environment.application, file).toBeUndefined();
      expect(pipeline.archiveComponent, file).toBe(`site:${pipeline.bucket}`);
    }
    const sourceId = environment.promotionSourceEnvironmentId;
    if (sourceId !== undefined) {
      expect(sourceId, file).not.toBe(environment.id);
      expect(environments.get(sourceId)?.serviceId, file).toBe(
        environment.serviceId,
      );
    }
  }
});
