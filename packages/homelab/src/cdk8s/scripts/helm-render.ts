#!/usr/bin/env bun
/**
 * Render CDK8s dist/ files through Helm's Go template engine.
 *
 * This ensures the same rendering pipeline as ArgoCD: content with {{ "{{" }}
 * escape sequences is processed by Helm, producing the correct output for
 * each consumer (Prometheus, event-exporter, HA Jinja2, Python).
 *
 * Modes:
 *   --render  (default) Write rendered YAML to rendered/ for inspection
 *   --apply   Pipe rendered YAML to kubectl apply
 *   --diff    Pipe rendered YAML to kubectl diff
 *   --chart <name>  Process a single chart instead of all
 *
 * See: packages/docs/guides/2026-04-04_helm-escaping-pipeline.md
 */
import { Glob } from "bun";
import path from "node:path";

const HELM_DIR = path.join(import.meta.dir, "../helm");
const DIST_DIR = path.join(import.meta.dir, "../dist");
const RENDERED_DIR = path.join(import.meta.dir, "../rendered");

const args = Bun.argv.slice(2);

type Mode = "render" | "apply" | "diff";
const mode: Mode = args.includes("--apply")
  ? "apply"
  : args.includes("--diff")
    ? "diff"
    : "render";

const chartFilterIdx = args.indexOf("--chart");
const chartFilter =
  chartFilterIdx === -1 ? null : (args[chartFilterIdx + 1] ?? null);

// Discover charts
const glob = new Glob("*/Chart.yaml");
const chartNames: string[] = [];
for await (const entry of glob.scan(HELM_DIR)) {
  const name = path.dirname(entry);
  if (chartFilter !== null && name !== chartFilter) continue;
  chartNames.push(name);
}
chartNames.sort();

if (chartNames.length === 0) {
  console.error(
    chartFilter === null
      ? "No charts found in helm/"
      : `No chart found matching "${chartFilter}"`,
  );
  process.exit(1);
}

let applied = 0;
let skipped = 0;
let failed = 0;

for (const chartName of chartNames) {
  const manifestFile = Bun.file(path.join(DIST_DIR, `${chartName}.k8s.yaml`));
  if (!(await manifestFile.exists())) {
    skipped++;
    continue;
  }

  // Create temp chart directory
  const tempDir = path.join(
    import.meta.dir,
    `../.helm-render-${chartName}-${String(Date.now())}`,
  );

  try {
    // Copy Chart.yaml with version placeholders replaced
    const chartYaml = await Bun.file(
      path.join(HELM_DIR, chartName, "Chart.yaml"),
    ).text();
    await Bun.write(
      path.join(tempDir, "Chart.yaml"),
      chartYaml
        .replace("$version", "0.0.0-dev")
        .replace("$appVersion", "0.0.0-dev"),
    );

    // Copy manifest into templates/
    await Bun.write(
      path.join(tempDir, "templates", `${chartName}.k8s.yaml`),
      manifestFile,
    );

    // Copy values.yaml if it exists
    const valuesFile = Bun.file(path.join(HELM_DIR, chartName, "values.yaml"));
    if (await valuesFile.exists()) {
      await Bun.write(path.join(tempDir, "values.yaml"), valuesFile);
    }

    // Run helm template
    const helmResult = Bun.spawnSync(["helm", "template", chartName, tempDir]);

    if (helmResult.exitCode !== 0) {
      console.error(`FATAL: helm template failed for ${chartName}:`);
      console.error(helmResult.stderr.toString());
      process.exit(1);
    }

    const rendered = helmResult.stdout.toString();

    switch (mode) {
      case "render": {
        await Bun.write(
          path.join(RENDERED_DIR, `${chartName}.k8s.yaml`),
          rendered,
        );
        console.log(`  ✓ ${chartName}`);

        break;
      }
      case "apply": {
        const proc = Bun.spawn(["kubectl", "apply", "-f", "-"], {
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        });
        await proc.stdin.write(rendered);
        await proc.stdin.end();
        const exitCode = await proc.exited;
        if (exitCode === 0) {
          applied++;
        } else {
          console.error(`kubectl apply failed for ${chartName}`);
          failed++;
        }

        break;
      }
      case "diff": {
        const proc = Bun.spawn(["kubectl", "diff", "-f", "-"], {
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        });
        await proc.stdin.write(rendered);
        await proc.stdin.end();
        await proc.exited;
        // kubectl diff returns 1 when there are differences — not an error
        applied++;

        break;
      }
      // No default
    }
  } finally {
    Bun.spawnSync(["rm", "-rf", tempDir]);
  }
}

// Summary
if (mode === "render") {
  console.log(
    `\nRendered ${String(chartNames.length - skipped)} chart(s) → rendered/`,
  );
  if (skipped > 0) {
    console.log(`Skipped ${String(skipped)} chart(s) with no dist file`);
  }
} else if (mode === "apply") {
  console.log(
    `\nApplied ${String(applied)} chart(s)${failed > 0 ? `, ${String(failed)} failed` : ""}`,
  );
  if (failed > 0) process.exit(1);
}
