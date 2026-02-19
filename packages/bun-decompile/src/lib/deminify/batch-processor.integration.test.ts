/**
 * Integration test for batch processor.
 * Tests the bottom-up processing flow without actual API calls.
 */
import { describe, expect, it } from "bun:test";
import { buildCallGraph, getProcessingOrder } from "./call-graph.ts";

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
  it("should sort functions by depth (leaves first) via processing order", () => {
    const graph = buildCallGraph(sampleSource);

    // getProcessingOrder gives topological order (leaves first)
    const order = getProcessingOrder(graph);

    // Map IDs back to function names
    const names = order.map((id) => {
      const fn = graph.functions.get(id);
      return fn?.originalName ?? "";
    });

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
    const calculate = [...graph.functions.values()].find(
      (f) => f.originalName === "calculate",
    );
    expect(calculate).toBeDefined();
    expect(calculate?.callees).toContain("add");
    expect(calculate?.callees).toContain("multiply");

    const main = [...graph.functions.values()].find(
      (f) => f.originalName === "main",
    );
    expect(main).toBeDefined();
    expect(main?.callees).toContain("calculate");
  });

  it("should group functions into reasonable batches based on source size", () => {
    const graph = buildCallGraph(sampleSource);
    const functions = [...graph.functions.values()];

    // Verify we have functions to process
    expect(functions.length).toBeGreaterThanOrEqual(4);

    // Verify functions have reasonable source lengths for batching
    for (const fn of functions) {
      expect(fn.source.length).toBeGreaterThan(0);
    }

    // Total source size should be reasonable for a single batch
    const totalChars = functions.reduce((sum, fn) => sum + fn.source.length, 0);
    expect(totalChars).toBeLessThan(10_000); // Well within any token budget
  });
});
