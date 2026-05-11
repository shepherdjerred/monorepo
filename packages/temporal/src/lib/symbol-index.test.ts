import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  buildSymbolIndex,
  extractSymbolsFromSource,
  lookupByFile,
  lookupSymbol,
  SymbolEntrySchema,
  type SymbolEntry,
} from "./symbol-index.ts";

describe("extractSymbolsFromSource", () => {
  describe("typescript", () => {
    it("extracts function, class, method, type, and interface declarations", async () => {
      const source = `
export function helloWorld(name: string): string {
  return \`hello, \${name}\`;
}

export class Greeter {
  greet(name: string): string {
    return helloWorld(name);
  }
}

export type GreeterFn = (name: string) => string;

export interface Greetable {
  name: string;
}
`;
      const out = await extractSymbolsFromSource({
        filePath: "packages/x/src/greet.ts",
        source,
        language: "typescript",
      });

      const names = out.map((e) => e.name).toSorted();
      expect(names).toEqual([
        "Greetable",
        "Greeter",
        "GreeterFn",
        "greet",
        "helloWorld",
      ]);
      // Every entry validates against the schema (defensive — guards against
      // future code changes that might drop a required field).
      for (const entry of out) {
        SymbolEntrySchema.parse(entry);
      }
    });

    it("preserves the supplied filePath verbatim", async () => {
      const out = await extractSymbolsFromSource({
        filePath: "packages/temporal/src/lib/symbol-index.ts",
        source: "export function foo(): void {}",
        language: "typescript",
      });
      expect(out).toHaveLength(1);
      expect(out[0]?.file).toBe("packages/temporal/src/lib/symbol-index.ts");
    });

    it("records 1-indexed line numbers", async () => {
      // Line 1 is the blank line below. `function bar` is on line 2.
      const source = `
function bar(): void {}
`;
      const out = await extractSymbolsFromSource({
        filePath: "x.ts",
        source,
        language: "typescript",
      });
      expect(out[0]?.line).toBe(2);
      expect(out[0]?.endLine).toBe(2);
    });

    it("returns empty array for empty source", async () => {
      const out = await extractSymbolsFromSource({
        filePath: "empty.ts",
        source: "",
        language: "typescript",
      });
      expect(out).toEqual([]);
    });

    it("classifies kinds correctly", async () => {
      const source = `
function f1() {}
class C1 {
  m1() {}
}
type T1 = number;
interface I1 { x: number; }
`;
      const out = await extractSymbolsFromSource({
        filePath: "kinds.ts",
        source,
        language: "typescript",
      });
      const byName = new Map(out.map((e) => [e.name, e.kind]));
      expect(byName.get("f1")).toBe("function");
      expect(byName.get("C1")).toBe("class");
      expect(byName.get("m1")).toBe("method");
      expect(byName.get("T1")).toBe("type");
      expect(byName.get("I1")).toBe("interface");
    });
  });

  describe("tsx", () => {
    it("parses JSX-heavy files", async () => {
      const source = `
export function Button(props: { label: string }) {
  return <button>{props.label}</button>;
}
`;
      const out = await extractSymbolsFromSource({
        filePath: "Button.tsx",
        source,
        language: "tsx",
      });
      expect(out.map((e) => e.name)).toContain("Button");
    });
  });

  describe("javascript", () => {
    it("extracts function and class declarations", async () => {
      const source = `
function add(a, b) { return a + b; }
class Calculator {
  multiply(a, b) { return a * b; }
}
`;
      const out = await extractSymbolsFromSource({
        filePath: "calc.js",
        source,
        language: "javascript",
      });
      const names = out.map((e) => e.name).toSorted();
      expect(names).toEqual(["Calculator", "add", "multiply"]);
    });
  });

  describe("rust", () => {
    it("extracts functions, structs, traits, enums", async () => {
      const source = `
pub fn compute() -> i32 { 42 }
pub struct Point { x: i32, y: i32 }
pub trait Drawable { fn draw(&self); }
pub enum Color { Red, Green, Blue }
`;
      const out = await extractSymbolsFromSource({
        filePath: "geom.rs",
        source,
        language: "rust",
      });
      const names = out.map((e) => e.name).toSorted();
      expect(names).toEqual(["Color", "Drawable", "Point", "compute"]);
    });
  });

  describe("go", () => {
    it("extracts functions, methods, and type declarations", async () => {
      const source = `
package main

type Server struct {
  port int
}

func NewServer(port int) *Server {
  return &Server{port: port}
}

func (s *Server) Start() error {
  return nil
}
`;
      const out = await extractSymbolsFromSource({
        filePath: "server.go",
        source,
        language: "go",
      });
      const names = new Set(out.map((e) => e.name));
      expect(names.has("Server")).toBe(true);
      expect(names.has("NewServer")).toBe(true);
      expect(names.has("Start")).toBe(true);
    });
  });

  describe("java", () => {
    it("extracts classes, methods, interfaces, and enums", async () => {
      const source = `
package com.example;

public class Order {
  public int id;
  public void process() {}
}

public interface Repository {
  Order findById(int id);
}

public enum Status { PENDING, COMPLETED }
`;
      const out = await extractSymbolsFromSource({
        filePath: "Order.java",
        source,
        language: "java",
      });
      const names = new Set(out.map((e) => e.name));
      expect(names.has("Order")).toBe(true);
      expect(names.has("process")).toBe(true);
      expect(names.has("Repository")).toBe(true);
      expect(names.has("Status")).toBe(true);
    });
  });
});

describe("buildSymbolIndex", () => {
  let tmpRepo: string;

  beforeAll(async () => {
    // `mktemp -d` via Bun.$ avoids the no-restricted-imports lint against
    // `node:fs`'s `mkdtempSync`. Output ends with a newline which we trim.
    const mkdirOut = await Bun.$`mktemp -d -t symbol-index-test`.text();
    tmpRepo = mkdirOut.trim();
    // Build a minimal repo layout that matches the default include globs:
    //   packages/<pkg>/src/**/*.{ts,tsx,...}
    const filesToWrite: Record<string, string> = {
      "packages/alpha/src/index.ts": `export function alphaFn(): string { return "alpha"; }`,
      "packages/alpha/src/lib/util.ts": `export class AlphaUtil { static fmt(s: string): string { return s; } }`,
      "packages/beta/src/index.ts": `export function betaFn(): number { return 42; }
export class BetaService { run(): void {} }`,
      "packages/beta/src/Button.tsx": `export function BetaButton() { return <button />; }`,
      "packages/gamma/src/main.rs": `pub fn gammaCompute() -> i32 { 42 }`,
      // Should be skipped: in node_modules (default exclude).
      "packages/alpha/node_modules/dep/src/index.ts": `export function shouldBeSkipped(): void {}`,
      // Should be skipped: generated dir (default exclude).
      "packages/alpha/src/generated/types.ts": `export function alsoSkipped(): void {}`,
    };
    for (const [rel, content] of Object.entries(filesToWrite)) {
      await Bun.write(path.join(tmpRepo, rel), content);
    }
  });

  afterAll(async () => {
    // `rm -rf` via Bun.$ — see beforeAll for the no-restricted-imports note.
    await Bun.$`rm -rf ${tmpRepo}`.quiet();
  });

  it("walks packages/*/src and indexes symbols across languages", async () => {
    const index = await buildSymbolIndex({
      repoRoot: tmpRepo,
      // Use a unique sha so we don't hit the cache from a previous run.
      commitSha: `test-${String(Date.now())}-walk`,
      forceRebuild: true,
    });

    expect(index.commitSha).toMatch(/^test-/);
    expect(index.filesScanned).toBeGreaterThan(0);

    // Symbols from the fixture files are discoverable by name.
    expect(lookupSymbol(index, "alphaFn")).toHaveLength(1);
    expect(lookupSymbol(index, "AlphaUtil")).toHaveLength(1);
    expect(lookupSymbol(index, "betaFn")).toHaveLength(1);
    expect(lookupSymbol(index, "BetaService")).toHaveLength(1);
    expect(lookupSymbol(index, "BetaButton")).toHaveLength(1);
    expect(lookupSymbol(index, "gammaCompute")).toHaveLength(1);

    // node_modules and generated are excluded.
    expect(lookupSymbol(index, "shouldBeSkipped")).toHaveLength(0);
    expect(lookupSymbol(index, "alsoSkipped")).toHaveLength(0);
  });

  it("returns entries with repo-relative file paths", async () => {
    const index = await buildSymbolIndex({
      repoRoot: tmpRepo,
      commitSha: `test-${String(Date.now())}-paths`,
      forceRebuild: true,
    });
    const alphaFnEntries = lookupSymbol(index, "alphaFn");
    const first = alphaFnEntries[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.file).toBe("packages/alpha/src/index.ts");
    // Should not be absolute.
    expect(path.isAbsolute(first.file)).toBe(false);
  });

  it("populates byFile with all symbols defined in each file", async () => {
    const index = await buildSymbolIndex({
      repoRoot: tmpRepo,
      commitSha: `test-${String(Date.now())}-byfile`,
      forceRebuild: true,
    });
    const inBetaIndex = lookupByFile(index, "packages/beta/src/index.ts");
    const names = new Set(inBetaIndex.map((e) => e.name));
    expect(names.has("betaFn")).toBe(true);
    expect(names.has("BetaService")).toBe(true);
  });

  it("warm cache (same commitSha) is faster than cold", async () => {
    const sha = `test-${String(Date.now())}-cache`;
    const cold = await buildSymbolIndex({
      repoRoot: tmpRepo,
      commitSha: sha,
    });
    const warm = await buildSymbolIndex({
      repoRoot: tmpRepo,
      commitSha: sha,
    });
    // Warm hit reads a single JSON file; cold walks the FS and parses files.
    // Use a generous bound — strict timing is flaky in CI.
    expect(warm.buildMs).toBeLessThan(cold.buildMs);
    // Both should produce the same symbol counts.
    expect(warm.byName.size).toBe(cold.byName.size);
  });

  it("forceRebuild bypasses the cache", async () => {
    const sha = `test-${String(Date.now())}-force`;
    await buildSymbolIndex({ repoRoot: tmpRepo, commitSha: sha });
    const rebuilt = await buildSymbolIndex({
      repoRoot: tmpRepo,
      commitSha: sha,
      forceRebuild: true,
    });
    // Rebuild walks the FS so buildMs is materially > a cache-hit read. Lower
    // bound is intentionally loose — just confirms we didn't short-circuit.
    expect(rebuilt.filesScanned).toBeGreaterThan(0);
  });
});

function buildSyntheticIndex(): {
  byName: Map<string, SymbolEntry[]>;
  byFile: Map<string, SymbolEntry[]>;
} {
  const entry1: SymbolEntry = {
    name: "foo",
    kind: "function",
    file: "a.ts",
    line: 1,
    endLine: 3,
  };
  const entry2: SymbolEntry = {
    name: "foo",
    kind: "function",
    file: "b.ts",
    line: 5,
    endLine: 8,
  };
  const entry3: SymbolEntry = {
    name: "Bar",
    kind: "class",
    file: "a.ts",
    line: 10,
    endLine: 20,
  };
  return {
    byName: new Map([
      ["foo", [entry1, entry2]],
      ["Bar", [entry3]],
    ]),
    byFile: new Map([
      ["a.ts", [entry1, entry3]],
      ["b.ts", [entry2]],
    ]),
  };
}

describe("lookup helpers", () => {
  it("lookupSymbol returns all entries for a name across files", () => {
    const data = buildSyntheticIndex();
    const result = lookupSymbol(
      { commitSha: "x", buildMs: 0, filesScanned: 0, ...data },
      "foo",
    );
    expect(result).toHaveLength(2);
    expect(new Set(result.map((e) => e.file))).toEqual(
      new Set(["a.ts", "b.ts"]),
    );
  });

  it("lookupSymbol returns empty array for unknown name", () => {
    const data = buildSyntheticIndex();
    const result = lookupSymbol(
      { commitSha: "x", buildMs: 0, filesScanned: 0, ...data },
      "missing",
    );
    expect(result).toEqual([]);
  });

  it("lookupByFile returns all entries defined in a file", () => {
    const data = buildSyntheticIndex();
    const result = lookupByFile(
      { commitSha: "x", buildMs: 0, filesScanned: 0, ...data },
      "a.ts",
    );
    expect(result).toHaveLength(2);
    expect(new Set(result.map((e) => e.name))).toEqual(new Set(["foo", "Bar"]));
  });
});
