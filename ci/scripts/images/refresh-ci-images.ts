#!/usr/bin/env bun
import { setupGitAuth } from "../../../scripts/lib/github-auth.ts";
import {
  readMaintenancePr,
  assertDraftUnchanged,
} from "../../../scripts/lib/maintenance-pr.ts";
import { run } from "../../../scripts/lib/run.ts";
import {
  ciImageDefinition,
  ciImageSourceFingerprint,
} from "./build-ci-image-core.ts";
import { parseCiImagePinState } from "./update-ci-image-pin-core.ts";

const root = new URL("../../..", import.meta.url).pathname;
const auth = await setupGitAuth(root);
let deferred = false;
try {
  for (const name of ["ci-base", "ci-playwright"]) {
    const definition = ciImageDefinition(name);
    const pr = await readMaintenancePr(definition.branch, auth.env);
    if (pr?.isDraft === false) {
      deferred = true;
      continue;
    }
    assertDraftUnchanged(pr);
    const fingerprint = await ciImageSourceFingerprint(definition);
    const pin = parseCiImagePinState(
      await Bun.file(`${root}/${definition.stateFile}`).json(),
    );
    if (pin.sourceFingerprint === fingerprint) {
      console.log(`${name}: committed source fingerprint is unchanged`);
      continue;
    }
    // Explicit tools, one workspace, sequential remote builds. No retry of
    // ambiguous repository writes; the coordinator retains their request ID.
    const result = await run(
      [
        "bash",
        "-c",
        [
          "set -euo pipefail",
          "MISE_TOOLCHAIN_SCOPE=automation . ci/scripts/toolchain.sh",
          "bun --no-install ci/scripts/reporting/buildkit-env.ts",
          `bun --no-install ci/scripts/images/build-ci-image.ts --image ${name} --candidate-out ${name}-candidate.json`,
          `bun --no-install ci/scripts/images/update-ci-image-pin.ts --candidate ${name}-candidate.json`,
        ].join("\n"),
      ],
      { cwd: root, capture: true },
    );
    console.log(result.stdout);
    if (result.stdout.split("\n").includes("CI_IMAGE_PROMOTION_DEFERRED"))
      deferred = true;
  }
  console.log(
    `CI_MAINTENANCE_RESULT ${JSON.stringify({ status: deferred ? "deferred" : "completed" })}`,
  );
} finally {
  await auth.cleanup();
}
