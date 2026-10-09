#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { z } from "zod";
import { publishReleaseRefinement } from "../lib/publish-release-refinement.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    clone: { type: "string" },
    body: { type: "string" },
    "expected-head": { type: "string" },
  },
  strict: true,
});
const args = z
  .object({
    clone: z.string().min(1),
    body: z.string().min(1),
    "expected-head": z.string(),
  })
  .parse(values);
const status = await publishReleaseRefinement({
  clone: args.clone,
  body: args.body,
  expectedHead: args["expected-head"],
  env: {},
});
console.log(JSON.stringify({ status }));
