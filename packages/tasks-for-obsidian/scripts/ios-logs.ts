import { $ } from "bun";
import { outputPath } from "./ios-scripts-core.ts";

if (import.meta.main) {
  const output = outputPath(Bun.argv[2]);
  console.log(`Streaming device logs to ${output} (Ctrl+C to stop)`);
  await $`xcrun simctl spawn booted log stream --predicate ${'process == "TasksForObsidian"'} --level debug | tee ${output}`;
}
