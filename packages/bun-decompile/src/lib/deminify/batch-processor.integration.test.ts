/**
 * Integration test for batch processor.
 * Tests the bottom-up processing flow without actual API calls.
 */
import { describe, expect, it } from "bun:test";
import { BatchProcessor } from "./batch-processor.ts";
import { FunctionCache } from "./function-cache.ts";
import { buildCallGraph } from "./call-graph.ts";
import type { DeminifyConfig } from "./types.ts";
import { tmpdir } from "os";
import { join } from "path";

// Sample minified code with call dependencies
const sampleSource = `
function add(a, b) {
  return a + b;
}

function multiply(x, y) {
  return x * y;
}

function calculate(n1, n2, n3) {
  const sum = add(n1, n2);
  const product = multiply(sum, n3);
  return product;
}

function main() {
  const result = calculate(1, 2, 3);
  console.log(result);
}

main();
`;

describe("BatchProcessor integration", () => {
  it("should sort functions by depth (leaves first)", async () => {
    const config: DeminifyConfig = {
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-sonnet-4-20250514",
      maxTokens: 4096,
      cacheEnabled: true,
      cacheDir: join(tmpdir(), `bun-decompile-test-${String(Date.now())}`),
      concurrency: 1,
      rateLimit: 10,
      verbose: false,
      maxFunctionSize: 50000,
      minFunctionSize: 10,
    };

    const cache = new FunctionCache(config.cacheDir, config.model);
    await cache.init();

    const processor = new BatchProcessor(config, cache);
    const graph = buildCallGraph(sampleSource);

    // Access private method via type assertion for testing
    const sortByDepth = (processor as unknown as { sortByDepth: (g: typeof graph) => unknown[] }).sortByDepth;
    const sorted = sortByDepth.call(processor, graph);

    // Verify that leaf functions (add, multiply) come before their callers (calculate, main)
    const names = (sorted as { originalName: string }[]).map(f => f.originalName);

    // add and multiply should come before calculate
    const addIndex = names.indexOf("add");
    const multiplyIndex = names.indexOf("multiply");
    const calculateIndex = names.indexOf("calculate");
    const mainIndex = names.indexOf("main");

    expect(addIndex).toBeLessThan(calculateIndex);
    expect(multiplyIndex).toBeLessThan(calculateIndex);
    expect(calculateIndex).toBeLessThan(mainIndex);
  });

  it("should build call graph correctly", () => {
    const graph = buildCallGraph(sampleSource);

    expect(graph.functions.size).toBeGreaterThanOrEqual(4);

    // Find functions by name
    const calculate = Array.from(graph.functions.values()).find(f => f.originalName === "calculate");
    expect(calculate).toBeDefined();
    expect(calculate?.callees).toContain("add");
    expect(calculate?.callees).toContain("multiply");

    const main = Array.from(graph.functions.values()).find(f => f.originalName === "main");
    expect(main).toBeDefined();
    expect(main?.callees).toContain("calculate");
  });

  it("should create batches respecting token budget", async () => {
    const config: DeminifyConfig = {
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-sonnet-4-20250514",
      maxTokens: 4096,
      cacheEnabled: true,
      cacheDir: join(tmpdir(), `bun-decompile-test-${String(Date.now())}`),
      concurrency: 1,
      rateLimit: 10,
      verbose: false,
      maxFunctionSize: 50000,
      minFunctionSize: 10,
    };

    const cache = new FunctionCache(config.cacheDir, config.model);
    await cache.init();

    const processor = new BatchProcessor(config, cache);
    const graph = buildCallGraph(sampleSource);
    const functions = Array.from(graph.functions.values());

    // Access private method for testing
    const createBatches = (processor as unknown as {
      createBatches: (funcs: typeof functions, maxTokens: number, source: string) => unknown[][]
    }).createBatches;

    // With a very small token budget, each function should be in its own batch
    const smallBatches = createBatches.call(processor, functions, 100, sampleSource);
    expect(smallBatches.length).toBeGreaterThanOrEqual(1);

    // With a large token budget, all functions should fit in one batch
    const largeBatches = createBatches.call(processor, functions, 100000, sampleSource);
    expect(largeBatches.length).toBe(1);
  });
});
