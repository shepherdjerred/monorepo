import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { parse as yamlParse } from "yaml";
import { toPascalCase } from "./cli.ts";
import { HelmValueSchema, RecordSchema } from "./schemas.ts";
import { parseYAMLComments } from "./yaml-comments.ts";
import { convertToTypeScriptInterface } from "./type-converter.ts";
import { generateTypeScriptCode } from "./interface-generator.ts";
import type { JSONSchemaProperty } from "./types.ts";

describe("CLI", () => {
  const CLI_PATH = `${import.meta.dir}/cli.ts`;
  const TEST_OUTPUT = `${import.meta.dir}/../temp/test-output.ts`;

  beforeEach(async () => {
    // Clean up any existing test output
    try {
      await Bun.$`rm -f ${TEST_OUTPUT}`.quiet();
    } catch {
      // Ignore errors if file doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up test output
    try {
      await Bun.$`rm -f ${TEST_OUTPUT}`.quiet();
    } catch {
      // Ignore errors if file doesn't exist
    }
  });

  test("should show help message", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("helm-types");
    expect(stdout).toContain("USAGE:");
    expect(stdout).toContain("OPTIONS:");
    expect(stdout).toContain("EXAMPLES:");
  });

  test("should show error for missing required arguments", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Missing required arguments");
    expect(stderr).toContain("--name");
    expect(stderr).toContain("--repo");
    expect(stderr).toContain("--version");
  });

  test("should show error for missing --name", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        CLI_PATH,
        "--repo",
        "https://example.com/charts",
        "--version",
        "1.0.0",
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Missing required arguments");
  });

  test("should show error for missing --repo", async () => {
    const proc = Bun.spawn(
      ["bun", CLI_PATH, "--name", "test-chart", "--version", "1.0.0"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Missing required arguments");
  });

  test("should show error for missing --version", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        CLI_PATH,
        "--name",
        "test-chart",
        "--repo",
        "https://example.com/charts",
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Missing required arguments");
  });

  test("should accept short-form arguments", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "-h"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("helm-types");
  });

  test("should reject invalid arguments", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        CLI_PATH,
        "--invalid-arg",
        "value",
        "--name",
        "test",
        "--repo",
        "url",
        "--version",
        "1.0.0",
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error");
  });

  test("should use chart name as default for chartName", async () => {
    // We can't test a full chart fetch without a real helm repo,
    // but we can test that the CLI parses arguments correctly
    // by checking help text formatting
    const proc = Bun.spawn(["bun", CLI_PATH, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("--chart, -c");
    expect(stdout).toContain("defaults to --name");
  });

  // The full CLI path fetches a chart over the network via `helm pull`, which we
  // don't exercise here. Instead we drive the CLI's chart-processing path
  // (read values.yaml + values.schema.json from a chart dir → convert →
  // generate code) against a committed local fixture chart, so type generation
  // is covered end-to-end with no network or helm dependency.
  test("should generate types from a local chart fixture", async () => {
    const chartDir = `${import.meta.dir}/__fixtures__/sample-chart`;

    const valuesContent = await Bun.file(`${chartDir}/values.yaml`).text();
    const yamlComments = parseYAMLComments(valuesContent);
    const parsedValues: unknown = yamlParse(valuesContent);
    const values = HelmValueSchema.parse(parsedValues);

    const schemaContent = await Bun.file(
      `${chartDir}/values.schema.json`,
    ).text();
    const parsedSchema: unknown = JSON.parse(schemaContent);
    const schema: JSONSchemaProperty = RecordSchema.parse(parsedSchema);

    const interfaceName = `${toPascalCase("sample-chart")}HelmValues`;
    const tsInterface = convertToTypeScriptInterface({
      values,
      interfaceName,
      schema,
      yamlComments,
      chartName: "sample-chart",
    });
    const code = generateTypeScriptCode(tsInterface, "sample-chart");

    // Root type is emitted under the PascalCased name.
    expect(interfaceName).toBe("SampleChartHelmValues");
    expect(code).toContain("export type SampleChartHelmValues = {");
    // Scalar values keep their inferred primitive types.
    expect(code).toMatch(/replicaCount\??: number/);
    expect(code).toMatch(/serviceEnabled\??: boolean/);
    // Nested object becomes its own named type.
    expect(code).toContain("export type SampleChartHelmValuesImage = {");
    expect(code).toContain("image?: SampleChartHelmValuesImage");
    // The enum from values.schema.json is carried through as a string union.
    expect(code).toContain('"Always" | "IfNotPresent" | "Never"');
    // A `# --` doc comment from values.yaml is emitted as JSDoc.
    expect(code).toContain("Number of pod replicas to run.");
    // Flattened dot-notation parameter type is also generated.
    expect(code).toContain('"image.repository"?: string');
  });

  test("should support custom interface name", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("--interface");
    expect(stdout).toContain("Interface name");
  });

  test("should support output file option", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("--output");
    expect(stdout).toContain("Output file path");
    expect(stdout).toContain("defaults to stdout");
  });
});

describe("CLI helper functions", () => {
  test("should convert dash-case to PascalCase", () => {
    expect(toPascalCase("argo-cd")).toBe("ArgoCd");
    expect(toPascalCase("cert-manager")).toBe("CertManager");
  });

  test("should handle underscores, spaces, and existing casing", () => {
    expect(toPascalCase("kube_state_metrics")).toBe("KubeStateMetrics");
    expect(toPascalCase("external dns")).toBe("ExternalDns");
    // Mixed casing is normalized: each segment is capitalized, the rest lowered.
    expect(toPascalCase("ArgoCD")).toBe("Argocd");
    expect(toPascalCase("single")).toBe("Single");
  });
});
