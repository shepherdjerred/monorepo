import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

/** Native diagnostic commands require an explicit actor and a fresh output path. */
export function diagnosticPaths() {
  const args = parseArgs({
    options: { model: { type: "string" }, output: { type: "string" } },
    strict: true,
  });
  return {
    model: path.resolve(z.string().min(1).parse(args.values.model)),
    output: path.resolve(z.string().min(1).parse(args.values.output)),
  };
}
