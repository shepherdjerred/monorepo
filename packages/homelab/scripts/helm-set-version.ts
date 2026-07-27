import { setChartVersion } from "./migration-core.ts";

if (import.meta.main) {
  const [chartPath, version, extra] = Bun.argv.slice(2);
  if (chartPath === undefined || version === undefined || extra !== undefined) {
    throw new Error(
      "Usage: bun scripts/helm-set-version.ts <Chart.yaml> <version>",
    );
  }
  const chart = Bun.file(chartPath);
  if (!(await chart.exists()))
    throw new Error(`Chart.yaml not found: ${chartPath}`);
  await Bun.write(chartPath, setChartVersion(await chart.text(), version));
}
