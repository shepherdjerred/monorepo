/**
 * CI pipeline generator entry point.
 *
 * Detects changed packages, builds a Buildkite pipeline, and outputs JSON to stdout.
 * All diagnostic output goes to stderr so only the pipeline JSON goes to stdout.
 */
import { detectChanges } from "./change-detection.ts";
import { buildPipeline } from "./pipeline-builder.ts";
import { validateCatalog } from "./lib/validate-catalog.ts";

await validateCatalog();
const affected = await detectChanges();
const pipeline = buildPipeline(affected);
console.log(JSON.stringify(pipeline, null, 2));
