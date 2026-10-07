import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { promote } from "./bundle.ts";

const args = parseArgs({
  strict: true,
  options: {
    pilot: { type: "string" },
    evaluation: { type: "string" },
    model: { type: "string" },
    review: { type: "string" },
    parity: { type: "string" },
    receipt: { type: "string" },
    load: { type: "string" },
    regressions: { type: "string" },
    output: { type: "string" },
  },
});
const resolved = z
  .string()
  .min(1)
  .transform((file) => path.resolve(file));
const request = z
  .object({
    pilot: resolved,
    evaluation: resolved,
    model: resolved,
    review: resolved,
    parity: resolved,
    receipt: resolved,
    load: resolved,
    regressions: resolved,
    output: resolved,
  })
  .strict()
  .parse(args.values);
const result = await promote(request);
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
