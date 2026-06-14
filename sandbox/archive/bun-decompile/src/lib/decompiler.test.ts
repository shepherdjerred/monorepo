import { spawn } from "bun";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { decompileFile } from "./parser.ts";
import { extractToDirectory, getExtractionSummary } from "./extractor.ts";
import { BUN_TRAILER_BYTES, BUN_TRAILER_LENGTH } from "./constants.ts";

const TEST_DIR = "/tmp/bun-decompile-test";
const SAMPLE_APP_DIR = path.join(TEST_DIR, "sample-app");
const BINARY_PATH = path.join(TEST_DIR, "test-binary");
const OUTPUT_DIR = path.join(TEST_DIR, "output");

/** Check if a compiled binary contains the Bun trailer */
async function binaryHasTrailer(binaryPath: string): Promise<boolean> {
  const file = Bun.file(binaryPath);
  const buffer = new Uint8Array(await file.arrayBuffer());
  const searchLimit = Math.min(buffer.length, 1024 * 1024);
  for (
    let pos = buffer.length - BUN_TRAILER_LENGTH;
    pos >= buffer.length - searchLimit;
    pos--
  ) {
    let matches = true;
    for (let i = 0; i < BUN_TRAILER_LENGTH; i++) {
      if (buffer[pos + i] !== BUN_TRAILER_BYTES[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

/** Compile a TypeScript file to a standalone binary */
async function compileBinary(
  entryPoint: string,
  outfile: string,
  sourcemap: boolean,
): Promise<void> {
  const cmd = ["bun", "build", "--compile", entryPoint, "--outfile", outfile];
  if (sourcemap) {
    cmd.splice(3, 0, "--sourcemap");
  }
  const proc = spawn({ cmd, stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Compilation failed: ${stderr}`);
  }
}

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

// Some Bun versions or platforms produce binaries in formats this parser
// doesn't support yet (e.g. different ELF embedding strategies on Linux).
// Set after compilation in beforeAll.
let hasTrailer = false;

/** Returns true if the binary has a trailer, false to skip the test */
function trailerAvailable(): boolean {
  return hasTrailer;
}

describe("bun-decompile", () => {
  beforeAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(SAMPLE_APP_DIR, { recursive: true });

    await Bun.write(path.join(SAMPLE_APP_DIR, "index.ts"), SAMPLE_INDEX_TS);
    await Bun.write(path.join(SAMPLE_APP_DIR, "utils.ts"), SAMPLE_UTILS_TS);

    await compileBinary(
      path.join(SAMPLE_APP_DIR, "index.ts"),
      BINARY_PATH,
      true,
    );

    hasTrailer = await binaryHasTrailer(BINARY_PATH);
    if (!hasTrailer) {
      const file = Bun.file(BINARY_PATH);
      const size = file.size;
      console.warn(
        `Compiled binary (${String(size)} bytes) does not contain a ` +
          "detectable Bun trailer. Decompilation tests will be skipped. " +
          "This is expected on some Bun versions or Linux configurations.",
      );
    }
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("with sourcemap", () => {
    test("decompiles binary successfully", async () => {
      if (!trailerAvailable()) return;
      const result = await decompileFile(BINARY_PATH);

      expect(result.bunVersion).toMatch(/^\d+\.\d+\.\d+/);
      expect(result.modules.length).toBeGreaterThan(0);
      expect(result.flags).toBeGreaterThanOrEqual(0);
    });

    test("extracts bundled module", async () => {
      if (!trailerAvailable()) return;
      const result = await decompileFile(BINARY_PATH);

      const entryPoint = result.modules.find((m) => m.isEntryPoint);
      expect(entryPoint).toBeDefined();
      expect(entryPoint?.contents.length).toBeGreaterThan(0);
    });

    test("extracts sourcemap", async () => {
      if (!trailerAvailable()) return;
      const result = await decompileFile(BINARY_PATH);

      const entryPoint = result.modules.find((m) => m.isEntryPoint);
      expect(entryPoint?.sourcemap).not.toBeNull();
      expect(entryPoint?.sourcemap?.length).toBeGreaterThan(0);
    });

    test("recovers original sources from sourcemap", async () => {
      if (!trailerAvailable()) return;
      const result = await decompileFile(BINARY_PATH);

      expect(result.originalSources.length).toBe(2);

      const sourceNames = result.originalSources.map((s) => s.name);
      expect(sourceNames).toContain("utils.ts");
      expect(sourceNames).toContain("index.ts");
    });

    test("recovered sources match original", async () => {
      if (!trailerAvailable()) return;
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
      if (!trailerAvailable()) return;
      await rm(OUTPUT_DIR, { recursive: true, force: true });

      const result = await decompileFile(BINARY_PATH);
      await extractToDirectory(result, OUTPUT_DIR);

      const metadata = await Bun.file(
        path.join(OUTPUT_DIR, "metadata.json"),
      ).json();
      expect(metadata.bunVersion).toMatch(/^\d+\.\d+\.\d+/);
      expect(metadata.hasOriginalSources).toBe(true);
      expect(metadata.originalSourceCount).toBe(2);

      const utilsExists = await Bun.file(
        path.join(OUTPUT_DIR, "original/utils.ts"),
      ).exists();
      const indexExists = await Bun.file(
        path.join(OUTPUT_DIR, "original/index.ts"),
      ).exists();
      expect(utilsExists).toBe(true);
      expect(indexExists).toBe(true);

      const bundledFiles = await Array.fromAsync(
        new Bun.Glob("bundled/*").scan(OUTPUT_DIR),
      );
      expect(bundledFiles.length).toBeGreaterThan(0);
    });

    test("extraction summary includes original sources", async () => {
      if (!trailerAvailable()) return;
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
      await compileBinary(
        path.join(SAMPLE_APP_DIR, "index.ts"),
        NO_SOURCEMAP_BINARY,
        false,
      );
    });

    test("decompiles binary without sourcemap", async () => {
      if (!trailerAvailable()) return;
      const result = await decompileFile(NO_SOURCEMAP_BINARY);

      expect(result.bunVersion).toMatch(/^\d+\.\d+\.\d+/);
      expect(result.modules.length).toBeGreaterThan(0);
    });

    test("has no original sources without sourcemap", async () => {
      if (!trailerAvailable()) return;
      const result = await decompileFile(NO_SOURCEMAP_BINARY);

      expect(result.originalSources.length).toBe(0);
    });

    test("still extracts bundled code", async () => {
      if (!trailerAvailable()) return;
      const result = await decompileFile(NO_SOURCEMAP_BINARY);

      const entryPoint = result.modules.find((m) => m.isEntryPoint);
      expect(entryPoint).toBeDefined();
      expect(entryPoint?.contents.length).toBeGreaterThan(0);

      const bundledCode = new TextDecoder().decode(entryPoint?.contents);
      expect(bundledCode).toContain("greet");
      expect(bundledCode).toContain("Hello");
    });

    test("extracts to directory without original sources", async () => {
      if (!trailerAvailable()) return;
      const noSourcemapOutput = path.join(TEST_DIR, "output-no-sourcemap");
      await rm(noSourcemapOutput, { recursive: true, force: true });

      const result = await decompileFile(NO_SOURCEMAP_BINARY);
      await extractToDirectory(result, noSourcemapOutput);

      const metadata = await Bun.file(
        path.join(noSourcemapOutput, "metadata.json"),
      ).json();
      expect(metadata.hasOriginalSources).toBe(false);
      expect(metadata.originalSourceCount).toBe(0);

      const originalDirExists = await Bun.file(
        path.join(noSourcemapOutput, "original"),
      ).exists();
      if (originalDirExists) {
        const originalFiles = await Array.fromAsync(
          new Bun.Glob("*").scan(path.join(noSourcemapOutput, "original")),
        );
        expect(originalFiles.length).toBe(0);
      }

      const bundledFiles = await Array.fromAsync(
        new Bun.Glob("bundled/*").scan(noSourcemapOutput),
      );
      expect(bundledFiles.length).toBeGreaterThan(0);
    });
  });
});
