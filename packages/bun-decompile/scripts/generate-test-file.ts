#!/usr/bin/env bun
/**
 * Generate a minified-looking JavaScript file of arbitrary size for testing.
 *
 * Usage:
 *   bun scripts/generate-test-file.ts [options]
 *
 * Options:
 *   -n, --functions <n>   Number of functions to generate (default: 100)
 *   -o, --output <path>   Output file path (default: ./test-minified.js)
 *   --minify              Minify output (single-letter names, no whitespace)
 */

import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    functions: { type: "string", short: "n", default: "100" },
    output: { type: "string", short: "o", default: "./test-minified.js" },
    minify: { type: "boolean", default: true },
  },
});

const numFunctions = parseInt(values.functions!, 10);
const outputPath = values.output!;
const minify = values.minify!;

// Generate minified-style variable names (prefixed to avoid collisions)
function minName(index: number, prefix: string = "f"): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let name = "";
  let n = index;
  do {
    name = chars[n % chars.length] + name;
    n = Math.floor(n / chars.length) - 1;
  } while (n >= 0);
  return prefix + name;
}

// Generate readable names for non-minified output
function readableName(index: number, type: string): string {
  const prefixes: Record<string, string[]> = {
    func: [
      "calculate",
      "process",
      "handle",
      "validate",
      "transform",
      "parse",
      "format",
      "render",
      "fetch",
      "update",
    ],
    var: [
      "result",
      "value",
      "data",
      "item",
      "temp",
      "count",
      "index",
      "buffer",
      "state",
      "config",
    ],
    param: [
      "input",
      "options",
      "callback",
      "context",
      "args",
      "props",
      "event",
      "element",
      "source",
      "target",
    ],
  };
  const prefix = prefixes[type]![index % prefixes[type]!.length];
  return `${prefix}${Math.floor(index / 10)}`;
}

// Generate different function patterns
function generateFunction(index: number, minify: boolean): string {
  const fname = minify ? minName(index, "_f") : readableName(index, "func");
  const param1 = minify ? minName(index, "_p") : readableName(index, "param");
  const param2 = minify
    ? minName(index + 1, "_q")
    : readableName(index + 1, "param");
  const local1 = minify ? minName(index, "_v") : readableName(index, "var");
  const local2 = minify
    ? minName(index + 1, "_w")
    : readableName(index + 1, "var");

  const patterns = [
    // Simple arithmetic
    () =>
      `function ${fname}(${param1},${param2}){var ${local1}=${param1}+${param2};return ${local1}*2}`,

    // Conditional
    () =>
      `function ${fname}(${param1}){if(${param1}>0){return ${param1}*2}else{return -${param1}}}`,

    // Loop
    () =>
      `function ${fname}(${param1}){var ${local1}=0;for(var ${local2}=0;${local2}<${param1};${local2}++){${local1}+=${local2}}return ${local1}}`,

    // Array operation
    () =>
      `function ${fname}(${param1}){return ${param1}.map(function(${local1}){return ${local1}*2}).filter(function(${local2}){return ${local2}>0})}`,

    // Object manipulation
    () =>
      `function ${fname}(${param1}){var ${local1}={};for(var ${local2} in ${param1}){${local1}[${local2}]=${param1}[${local2}]+1}return ${local1}}`,

    // String operation
    () =>
      `function ${fname}(${param1}){return ${param1}.split("").reverse().join("")}`,

    // Recursion
    () =>
      `function ${fname}(${param1}){if(${param1}<=1)return 1;return ${param1}*${fname}(${param1}-1)}`,

    // Closure
    () =>
      `function ${fname}(${param1}){var ${local1}=${param1};return function(${param2}){return ${local1}+${param2}}}`,

    // Promise-like
    () =>
      `function ${fname}(${param1}){return new Promise(function(${local1},${local2}){setTimeout(function(){${local1}(${param1})},100)})}`,

    // Error handling
    () =>
      `function ${fname}(${param1}){try{return JSON.parse(${param1})}catch(${local1}){return null}}`,

    // Arrow in var (common minified pattern)
    () => `var ${fname}=(${param1})=>${param1}*2;`,

    // IIFE pattern
    () =>
      `var ${fname}=(function(){var ${local1}=0;return function(){return ++${local1}}})();`,

    // Method chain simulation
    () =>
      `function ${fname}(${param1}){return{value:${param1},add:function(${local1}){return ${fname}(this.value+${local1})},get:function(){return this.value}}}`,

    // Bitwise operations (common in minified code)
    () => `function ${fname}(${param1}){return(${param1}|0)>>>0}`,

    // Ternary chain
    () => `function ${fname}(${param1}){return ${param1}<0?-1:${param1}>0?1:0}`,
  ];

  return patterns[index % patterns.length]!();
}

// Generate interconnected functions (some call others)
function generateProgram(numFunctions: number, minify: boolean): string {
  const lines: string[] = [];

  // Add header
  lines.push(minify ? '"use strict";' : '"use strict";\n');

  // Generate helper constants
  const constName = minify ? "c" : "constants";
  lines.push(
    minify
      ? `var ${constName}={PI:3.14159,E:2.71828,MAX:1e6};`
      : `var ${constName} = { PI: 3.14159, E: 2.71828, MAX: 1e6 };`
  );

  // Generate functions
  for (let i = 0; i < numFunctions; i++) {
    const func = generateFunction(i, minify);
    lines.push(func);
  }

  // Generate some inter-function calls
  const mainName = minify ? "main" : "main";
  const calls: string[] = [];
  for (let i = 0; i < Math.min(10, numFunctions); i++) {
    const fname = minify ? minName(i, "_f") : readableName(i, "func");
    calls.push(`${fname}(${i})`);
  }

  lines.push(
    minify
      ? `function ${mainName}(){return[${calls.join(",")}]}`
      : `function ${mainName}() { return [${calls.join(", ")}]; }`
  );

  // Export for module usage
  lines.push(
    minify
      ? `if(typeof module!=="undefined")module.exports={main:${mainName}};`
      : `if (typeof module !== "undefined") module.exports = { main: ${mainName} };`
  );

  return lines.join(minify ? "" : "\n\n");
}

// Generate and write
console.log(`Generating ${numFunctions} functions...`);
const code = generateProgram(numFunctions, minify);
await Bun.write(outputPath, code);

const stats = await Bun.file(outputPath).stat();
console.log(`Written to: ${outputPath}`);
console.log(`Size: ${(stats.size / 1024).toFixed(1)} KB`);
console.log(`Functions: ${numFunctions}`);
