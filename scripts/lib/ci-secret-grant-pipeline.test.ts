import { describe, expect, test } from "vitest";
import { parse } from "yaml";

import { collectSteps, compareStepGrants } from "./ci-secret-grant-pipeline.ts";
import type { SecretGrant } from "./ci-secret-grant-schema.ts";

const GRANT: SecretGrant = {
  env: "TOKEN",
  secret: "buildkite-test-credentials",
  key: "TOKEN",
};

function pipelineWith(fragment: string): unknown {
  return parse(
    `
steps:
  - key: test-step
    command: bun scripts/release.ts
    plugins:
      - kubernetes:
          podSpecPatch:
            serviceAccountName: buildkite-job
            automountServiceAccountToken: false
            containers:
              - name: checkout
              - name: container-0
${fragment}
`,
    { merge: true },
  );
}

describe("exact Buildkite grants", () => {
  test("accepts an exact command-container grant", () => {
    const collected = collectSteps(
      pipelineWith(
        `                env:
                  - name: TOKEN
                    valueFrom:
                      secretKeyRef:
                        name: buildkite-test-credentials
                        key: TOKEN`,
      ),
      [],
    );

    expect(collected.errors).toEqual([]);
    expect(
      compareStepGrants(collected.steps, { "test-step": [GRANT] }),
    ).toEqual([]);
  });

  test("reports missing and excessive grants", () => {
    const absent = collectSteps(pipelineWith(""), []);
    expect(compareStepGrants(absent.steps, { "test-step": [GRANT] })).toContain(
      'step "test-step" is missing grant TOKEN <- buildkite-test-credentials/TOKEN',
    );

    const present = collectSteps(
      pipelineWith(
        `                env:
                  - name: TOKEN
                    valueFrom:
                      secretKeyRef:
                        name: buildkite-test-credentials
                        key: TOKEN`,
      ),
      [],
    );
    expect(compareStepGrants(present.steps, { "test-step": [] })[0]).toContain(
      "excessive grant",
    );
  });

  test("rejects secrets on auxiliary containers", () => {
    const pipeline = parse(
      `
steps:
  - key: test-step
    command: bun scripts/release.ts
    plugins:
      - kubernetes:
          podSpecPatch:
            serviceAccountName: buildkite-job
            automountServiceAccountToken: false
            containers:
              - name: checkout
                env:
                  - name: TOKEN
                    valueFrom:
                      secretKeyRef: { name: buildkite-test-credentials, key: TOKEN }
              - name: container-0
`,
      { merge: true },
    );

    expect(collectSteps(pipeline, []).errors.join("\n")).toContain(
      "receives secret environment variable TOKEN",
    );
  });

  test("rejects envFrom and optional secret references", () => {
    const collected = collectSteps(
      pipelineWith(
        `                envFrom:
                  - secretRef: { name: buildkite-test-credentials }
                env:
                  - name: TOKEN
                    valueFrom:
                      secretKeyRef:
                        name: buildkite-test-credentials
                        key: TOKEN
                        optional: false`,
      ),
      [],
    );

    expect(collected.errors.join("\n")).toContain("declares envFrom");
    expect(collected.errors.join("\n")).toContain(
      "declares optional on a secretKeyRef",
    );
  });

  test("rejects direct and projected Secret volumes", () => {
    const pipeline = parse(
      `
steps:
  - key: direct-secret-volume
    command: bun scripts/release.ts
    plugins:
      - kubernetes:
          podSpecPatch:
            serviceAccountName: buildkite-job
            automountServiceAccountToken: false
            volumes:
              - name: credentials
                secret:
                  secretName: buildkite-test-credentials
            containers:
              - name: checkout
              - name: container-0
  - key: projected-secret-volume
    command: bun scripts/release.ts
    plugins:
      - kubernetes:
          podSpecPatch:
            serviceAccountName: buildkite-job
            automountServiceAccountToken: false
            volumes:
              - name: credentials
                projected:
                  sources:
                    - configMap:
                        name: public-config
                    - secret:
                        name: buildkite-test-credentials
            containers:
              - name: checkout
              - name: container-0
`,
      { merge: true },
    );

    const errors = collectSteps(pipeline, []).errors;
    expect(errors).toContain(
      'step "direct-secret-volume": secret volumes are forbidden',
    );
    expect(errors).toContain(
      'step "projected-secret-volume": secret volumes are forbidden',
    );
  });

  test("requires the scoped Buildkite analytics grant for test collection", () => {
    const analyticsEnvironmentName = "BUILDKITE_ANALYTICS_TOKEN";
    const analyticsSecretName = "buildkite-analytics-credentials";
    const pipeline = parse(
      `
steps:
  - key: test-step
    command: bun scripts/release.ts
    plugins:
      - test-collector#v1.11.0: { files: reports/*.xml, format: junit }
      - kubernetes:
          podSpecPatch:
            serviceAccountName: buildkite-job
            automountServiceAccountToken: false
            containers:
              - name: checkout
              - name: container-0
`,
      { merge: true },
    );

    expect(collectSteps(pipeline, []).errors.join("\n")).toContain(
      `test-collector requires ${analyticsEnvironmentName} <- ${analyticsSecretName}/${analyticsEnvironmentName}`,
    );
  });

  test("rejects the privileged service account and token mounting", () => {
    const source = JSON.stringify(pipelineWith("")).replace(
      '"serviceAccountName":"buildkite-job","automountServiceAccountToken":false',
      '"serviceAccountName":"buildkite-agent-stack-k8s-controller","automountServiceAccountToken":true',
    );
    const errors = collectSteps(JSON.parse(source), []).errors.join("\n");

    expect(errors).toContain("serviceAccountName must be buildkite-job");
    expect(errors).toContain("automountServiceAccountToken must be false");
  });
});
