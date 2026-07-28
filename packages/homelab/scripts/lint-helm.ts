import { $ } from "bun";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chartName, setChartVersion } from "./migration-core.ts";

if (import.meta.main) {
  const root = import.meta.dir.replace(/\/scripts$/, "");
  const cdk8s = `${root}/src/cdk8s`;
  await $`bunx turbo run build --filter=@homelab/cdk8s`.cwd(root);
  for (const chartPath of new Bun.Glob("*/Chart.yaml").scanSync({
    cwd: `${cdk8s}/helm`,
    absolute: true,
  })) {
    const name = chartName(chartPath.replace(/\/Chart\.yaml$/, ""));
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "helm-lint-"));
    try {
      await cp(chartPath.replace(/\/Chart\.yaml$/, ""), temporaryDirectory, {
        recursive: true,
      });
      const chart = `${temporaryDirectory}/Chart.yaml`;
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
      await mkdir(`${temporaryDirectory}/templates`, { recursive: true });
      await Bun.write(
        `${temporaryDirectory}/templates/${name}.k8s.yaml`,
        Bun.file(manifest),
      );
      await $`helm lint ${temporaryDirectory}`;
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  }
}
