#!/usr/bin/env bun
// Compatibility with the old generator's PR rehearsal only. There is no writer.
import { rehearseRetiredCommitBack } from "../lib/ci/retired-release-rehearsal.ts";

const build = rehearseRetiredCommitBack(
  Bun.argv.slice(2),
  Bun.env["CI_PIPELINE_EVENT"],
);
console.log(
  `Validated retired commit-back rehearsal for build ${String(build)}; no Git deployment state exists`,
);
