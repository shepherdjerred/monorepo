#!/usr/bin/env bun

const runCommand = async (command: string, args: string[]) => {
  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "inherit",
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode === 0) {
    return output;
  }
  throw new Error(`Command failed with code ${String(exitCode)}`);
};

// Use gsed if available (macOS with GNU sed installed), otherwise use sed
const sedCommand = Bun.which("gsed") ? "gsed" : "sed";

// Files that may contain Intel GPU resources
const filesToPatch = ["dist/media.k8s.yaml", "dist/pokemon.k8s.yaml"];

console.log("🔧 Applying Intel GPU resource patches...");

// Define patterns to replace with their sed expressions
// Note: Patterns include optional leading whitespace since the YAML is indented
const gpuReplacements = [
  {
    pattern: "gpu.intel.com/i915: null",
    sedPattern: "s/\\(^[[:space:]]*\\)gpu\\.intel\\.com\\/i915: null/\\1gpu.intel.com\\/i915: 1/g",
  },
  {
    pattern: "gpu.intel.com/i915: 0",
    sedPattern: "s/\\(^[[:space:]]*\\)gpu\\.intel\\.com\\/i915: 0$/\\1gpu.intel.com\\/i915: 1/g",
  },
  {
    pattern: "gpu.intel.com/i915: '0'",
    sedPattern: "s/\\(^[[:space:]]*\\)gpu\\.intel\\.com\\/i915: '0'/\\1gpu.intel.com\\/i915: 1/g",
  },
  {
    pattern: 'gpu.intel.com/i915: "0"',
    sedPattern: 's/\\(^[[:space:]]*\\)gpu\\.intel\\.com\\/i915: "0"/\\1gpu.intel.com\\/i915: 1/g',
  },
];

for (const replacement of gpuReplacements) {
  for (const file of filesToPatch) {
    // Check if file exists before patching
    const fileExists = await Bun.file(file).exists();
    if (!fileExists) {
      continue;
    }

    try {
      await runCommand(sedCommand, ["-i", replacement.sedPattern, file]);
    } catch (error) {
      console.error(`✗ Failed to process pattern ${replacement.pattern} in ${file}:`, error);
    }
  }
  console.log(`✓ Processed pattern: ${replacement.pattern}`);
}

console.log("🎉 Intel GPU resource patches applied successfully!");
