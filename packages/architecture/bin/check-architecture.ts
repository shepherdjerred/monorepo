#!/usr/bin/env bun
import { realpath } from "node:fs/promises";
import { checkArchitecture } from "#src/cruise.ts";
import { loadArchitectureDefinition } from "#src/load-config.ts";

// dependency-cruiser reports realpaths. A symlinked working directory would
// make every module path absolute, so no rule would match and the check would
// pass while inspecting nothing.
const packageRoot = await realpath(process.cwd());
const definition = await loadArchitectureDefinition(packageRoot);
const result = await checkArchitecture({ packageRoot, definition });

if (result.errorCount > 0) {
  process.stderr.write(
    `${result.report}\n\n${String(result.errorCount)} architecture violation(s) in ${String(result.modulesCruised)} modules\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `architecture: ${String(result.modulesCruised)} modules clean\n`,
  );
}
