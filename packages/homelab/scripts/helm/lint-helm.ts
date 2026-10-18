import { $ } from "bun";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chartName, setChartVersion } from "#scripts/migration-core.ts";
import { workerPoolTemplate } from "#cdk8s/scripts/delivery/worker-pool-template.ts";
import { chartValidationValues } from "./helm-delivery-publication.ts";

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "../..");
  const cdk8s = `${root}/src/cdk8s`;
  for (const chartPath of new Bun.Glob("*/Chart.yaml").scanSync({
    cwd: `${cdk8s}/helm`,
    absolute: true,
  })) {
    const name = chartName(chartPath.replace(/\/Chart\.yaml$/, ""));
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "helm-lint-"));
    try {
      const chartDirectory = path.join(temporaryDirectory, name);
      await cp(chartPath.replace(/\/Chart\.yaml$/, ""), chartDirectory, {
        recursive: true,
      });
      const chart = `${chartDirectory}/Chart.yaml`;
      await Bun.write(
        chart,
        setChartVersion(await Bun.file(chart).text(), "0.0.0-lint"),
      );
      const manifest = `${cdk8s}/dist/${name}.k8s.yaml`;
      if (!(await Bun.file(manifest).exists())) {
        throw new Error(
          `No manifest found for ${name}; register it in setup-charts.ts`,
        );
      }
      await mkdir(`${chartDirectory}/templates`, { recursive: true });
      await Bun.write(
        `${chartDirectory}/templates/${name}.k8s.yaml`,
        workerPoolTemplate(await Bun.file(manifest).text(), name),
      );
      const values = chartValidationValues(name);
      const validationPath = path.join(temporaryDirectory, "validation.json");
      const arguments_ =
        values === undefined ? [] : ["--values", validationPath];
      if (values !== undefined)
        await Bun.write(validationPath, JSON.stringify(values));
      await $`helm lint ${chartDirectory} ${arguments_}`;
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  }
}
