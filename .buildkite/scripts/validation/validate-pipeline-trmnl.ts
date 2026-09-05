import { fail } from "./validate-pipeline-parse.ts";
import { containerBlock, requireIncludes } from "./validate-pipeline-lib.ts";

const TRMNLP_IMAGE =
  "trmnl/trmnlp:v0.11.0@sha256:4ac6d7f35ff30665b6c3b2634c2ba830488b2ee38783acc2ce953b652cb1c973";

export function validateTrmnlPipeline(
  stepBlocks: ReadonlyMap<string, string>,
): void {
  for (const step of ["trmnl-validate-pr", "trmnl-publish"]) {
    const command = containerBlock(step, stepBlocks.get(step), "container-0");
    const normalizedCommand = command.replaceAll(/\s+/g, " ");
    for (const required of [
      `image: "${TRMNLP_IMAGE}"`,
      "imagePullPolicy: IfNotPresent",
      "allowPrivilegeEscalation: false",
      'requests: { cpu: "1", memory: "2Gi", ephemeral-storage: "2Gi" }',
      'limits: { cpu: "2", memory: "4Gi", ephemeral-storage: "8Gi" }',
    ]) {
      if (!normalizedCommand.includes(required)) {
        fail(`${step} is missing pinned TRMNL container contract ${required}`);
      }
    }
  }

  const validationStep = stepBlocks.get("trmnl-validate-pr");
  const validationContainer = containerBlock(
    "trmnl-validate-pr",
    validationStep,
    "container-0",
  );
  if (validationContainer.includes("*grant_trmnl")) {
    fail("TRMNL pull request validation must remain secretless");
  }
  for (const required of [
    "packages/trmnl-dashboard/scripts/trmnlp-ci.sh self-test",
    "packages/trmnl-dashboard/scripts/trmnlp-ci.sh validate",
    "packages/trmnl-dashboard/trmnl/*/_build/*.html",
    "packages/trmnl-dashboard/trmnl/*/_build/*.png",
  ]) {
    requireIncludes(
      validationStep,
      required,
      `TRMNL PR validation is missing ${required}`,
    );
  }

  const publishStep = stepBlocks.get("trmnl-publish");
  requireIncludes(
    containerBlock("trmnl-publish", publishStep, "container-0"),
    "*grant_trmnl",
    "TRMNL main publication must receive its dedicated account credential",
  );
  for (const required of [
    "concurrency: 1",
    "concurrency_group: monorepo/trmnl-publish",
    "packages/trmnl-dashboard/scripts/trmnlp-ci.sh publish",
  ]) {
    requireIncludes(
      publishStep,
      required,
      `TRMNL publication is missing ${required}`,
    );
  }
}
