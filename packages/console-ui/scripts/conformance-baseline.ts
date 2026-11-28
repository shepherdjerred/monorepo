/**
 * Writes an app's conformance allowlist from what the scan finds today:
 *
 *   bun packages/console-ui/scripts/conformance-baseline.ts <dir> "<reason>" [also…]
 *
 * `<dir>` is the directory holding the app's `conformance.test.ts`; the
 * allowlist lands beside it as `conformance-allowlist.json`. Use it once to
 * start an app's baseline; afterwards lower counts by hand as fixes land.
 */
import path from "node:path";
import { scanConformance } from "@shepherdjerred/console-ui/testing/conformance.ts";

const [directory, reason, ...also] = Bun.argv.slice(2);
if (directory === undefined || reason === undefined || reason.trim() === "") {
  throw new Error(
    'Usage: conformance-baseline.ts <dir> "<reason>" [extra dirs…]',
  );
}
const found = await scanConformance(path.resolve(directory), { also });
const allowlist = found.map((entry) => ({ ...entry, reason }));
const target = path.join(path.resolve(directory), "conformance-allowlist.json");
await Bun.write(target, `${JSON.stringify(allowlist, null, 2)}\n`);
const total = allowlist.reduce((sum, entry) => sum + entry.count, 0);
console.warn(
  `${target}: ${String(allowlist.length)} entries, ${String(total)} violations`,
);
