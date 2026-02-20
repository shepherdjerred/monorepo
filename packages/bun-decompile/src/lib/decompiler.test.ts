import { spawn } from "bun";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { decompileFile } from "./parser.ts";
import { extractToDirectory, getExtractionSummary } from "./extractor.ts";

const TEST_DIR = "/tmp/bun-decompile-test";
const SAMPLE_APP_DIR = path.join(TEST_DIR, "sample-app");
const BINARY_PATH = path.join(TEST_DIR, "test-binary");
const OUTPUT_DIR = path.join(TEST_DIR, "output");

// Sample source files
const SAMPLE_INDEX_TS = `// Main entry point
import { greet, add } from "./utils.ts";

const name = process.argv[2] ?? "World";
console.log(greet(name));
console.log("2 + 3 =", add(2, 3));
`;

const SAMPLE_UTILS_TS = `// Utility functions
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export function add(a: number, b: number): number {
  return a + b;
}
`;

describe("bun-decompile", () => {
  beforeAll(async () => {
    // Clean up and create test directories
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(SAMPLE_APP_DIR, { recursive: true });

    // Write sample source files
    await Bun.write(path.join(SAMPLE_APP_DIR, "index.ts"), SAMPLE_INDEX_TS);
    await Bun.write(path.join(SAMPLE_APP_DIR, "utils.ts"), SAMPLE_UTILS_TS);
  });

  afterAll(async () => {
    // Clean up test directory
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("with sourcemap", () => {
    beforeAll(async () => {
      // Compile the sample app with sourcemap
      const proc = spawn({
        cmd: [
          "bun",
          "build",
          "--compile",
          "--sourcemap",
          path.join(SAMPLE_APP_DIR, "index.ts"),
          "--outfile",
          BINARY_PATH,
        ],
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`Compilation failed: ${stderr}`);
      }
    });

    test("decompiles binary successfully", async () => {
      const result = await decompileFile(BINARY_PATH);

      expect(result.bunVersion).toMatch(/^\d+\.\d+\.\d+/);
      expect(result.modules.length).toBeGreaterThan(0);
      expect(result.flags).toBeGreaterThanOrEqual(0);
    });

    test("extracts bundled module", async () => {
      const result = await decompileFile(BINARY_PATH);

      const entryPoint = result.modules.find((m) => m.isEntryPoint);
      expect(entryPoint).toBeDefined();
      expect(entryPoint?.contents.length).toBeGreaterThan(0);
    });

    test("extracts sourcemap", async () => {
      const result = await decompileFile(BINARY_PATH);

      const entryPoint = result.modules.find((m) => m.isEntryPoint);
      expect(entryPoint?.sourcemap).not.toBeNull();
      expect(entryPoint?.sourcemap?.length).toBeGreaterThan(0);
    });

    test("recovers original sources from sourcemap", async () => {
      const result = await decompileFile(BINARY_PATH);

      expect(result.originalSources.length).toBe(2);

      const sourceNames = result.originalSources.map((s) => s.name);
      expect(sourceNames).toContain("utils.ts");
      expect(sourceNames).toContain("index.ts");
    });

    test("recovered sources match original", async () => {
      const result = await decompileFile(BINARY_PATH);

      const utilsSource = result.originalSources.find(
        (s) => s.name === "utils.ts",
      );
      const indexSource = result.originalSources.find(
        (s) => s.name === "index.ts",
      );

      expect(utilsSource?.content).toBe(SAMPLE_UTILS_TS);
      expect(indexSource?.content).toBe(SAMPLE_INDEX_TS);
    });

    test("extracts to directory with correct structure", async () => {
      await rm(OUTPUT_DIR, { recursive: true, force: true });

      const result = await decompileFile(BINARY_PATH);
      await extractToDirectory(result, OUTPUT_DIR);

      // Check metadata.json
      const metadata = await Bun.file(
        path.join(OUTPUT_DIR, "metadata.json"),
      ).json();
      expect(metadata.bunVersion).toMatch(/^\d+\.\d+\.\d+/);
      expect(metadata.hasOriginalSources).toBe(true);
      expect(metadata.originalSourceCount).toBe(2);

      // Check original sources exist
      const utilsExists = await Bun.file(
        path.join(OUTPUT_DIR, "original/utils.ts"),
      ).exists();
      const indexExists = await Bun.file(
        path.join(OUTPUT_DIR, "original/index.ts"),
      ).exists();
      expect(utilsExists).toBe(true);
      expect(indexExists).toBe(true);

      // Check bundled sources exist
      const bundledFiles = await Array.fromAsync(
        new Bun.Glob("bundled/*").scan(OUTPUT_DIR),
      );
      expect(bundledFiles.length).toBeGreaterThan(0);
    });

    test("extraction summary includes original sources", async () => {
      const result = await decompileFile(BINARY_PATH);
      const summary = getExtractionSummary(result);

      expect(summary).toContain("Original Sources: 2");
      expect(summary).toContain("utils.ts");
      expect(summary).toContain("index.ts");
    });
  });

  describe("without sourcemap", () => {
    const NO_SOURCEMAP_BINARY = path.join(TEST_DIR, "test-binary-no-sourcemap");

    beforeAll(async () => {
      // Compile without sourcemap
      const proc = spawn({
        cmd: [
          "bun",
          "build",
          "--compile",
          path.join(SAMPLE_APP_DIR, "index.ts"),
          "--outfile",
          NO_SOURCEMAP_BINARY,
        ],
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`Compilation failed: ${stderr}`);
      }
    });

    test("decompiles binary without sourcemap", async () => {
      const result = await decompileFile(NO_SOURCEMAP_BINARY);

      expect(result.bunVersion).toMatch(/^\d+\.\d+\.\d+/);
      expect(result.modules.length).toBeGreaterThan(0);
    });

    test("has no original sources without sourcemap", async () => {
      const result = await decompileFile(NO_SOURCEMAP_BINARY);

      expect(result.originalSources.length).toBe(0);
    });

    test("still extracts bundled code", async () => {
      const result = await decompileFile(NO_SOURCEMAP_BINARY);

      const entryPoint = result.modules.find((m) => m.isEntryPoint);
      expect(entryPoint).toBeDefined();
      expect(entryPoint?.contents.length).toBeGreaterThan(0);

      // Bundled code should contain the transpiled greet function
      const bundledCode = new TextDecoder().decode(entryPoint?.contents);
      expect(bundledCode).toContain("greet");
      expect(bundledCode).toContain("Hello");
    });

    test("extracts to directory without original sources", async () => {
      const noSourcemapOutput = path.join(TEST_DIR, "output-no-sourcemap");
      await rm(noSourcemapOutput, { recursive: true, force: true });

      const result = await decompileFile(NO_SOURCEMAP_BINARY);
      await extractToDirectory(result, noSourcemapOutput);

      // Check metadata
      const metadata = await Bun.file(
        path.join(noSourcemapOutput, "metadata.json"),
      ).json();
      expect(metadata.hasOriginalSources).toBe(false);
      expect(metadata.originalSourceCount).toBe(0);

      // Original directory should not have files (or not exist)
      const originalDirExists = await Bun.file(
        path.join(noSourcemapOutput, "original"),
      ).exists();
      // Either doesn't exist or is empty
      if (originalDirExists) {
        const originalFiles = await Array.fromAsync(
          new Bun.Glob("*").scan(path.join(noSourcemapOutput, "original")),
        );
        expect(originalFiles.length).toBe(0);
      }

      // Bundled should still exist
      const bundledFiles = await Array.fromAsync(
        new Bun.Glob("bundled/*").scan(noSourcemapOutput),
      );
      expect(bundledFiles.length).toBeGreaterThan(0);
    });
  });
});
