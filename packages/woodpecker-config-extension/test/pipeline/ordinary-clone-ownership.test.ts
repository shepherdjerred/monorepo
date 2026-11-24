import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import {
  cacheSourceSteps,
  SOURCE_CACHE_PREPARATION_IMAGE,
} from "#src/pipeline/source-cache.ts";
import { emitWorkflow } from "#src/pipeline/emit.ts";
import { TEST_IDENTITY, testPipelineSteps } from "#test-identity";

function unescapeWoodpeckerYaml(yaml: string): string {
  return yaml.replaceAll(/\$\$|\\[\\/]/gu, (pair) => pair.slice(1));
}

const CloneSecurityContextSchema = z.looseObject({
  runAsUser: z.number().optional(),
  runAsGroup: z.number().optional(),
  fsGroup: z.number().optional(),
});

const CloneStepSchema = z.looseObject({
  name: z.string(),
  image: z.string(),
  commands: z.array(z.string()).optional(),
  volumes: z.array(z.string()).optional(),
  backend_options: z.object({
    kubernetes: z.looseObject({
      securityContext: CloneSecurityContextSchema.optional(),
    }),
  }),
});

const EmittedCloneSchema = z.object({
  clone: z.array(CloneStepSchema).optional(),
});

describe("ordinary clone ownership handoff", () => {
  test("resets workspace and .git root ownership to 0:0 before root build steps run", () => {
    const verify = testPipelineSteps().find((step) => step.key === "verify");
    if (verify === undefined) throw new Error("Missing verify fixture");

    const ordinary = EmittedCloneSchema.parse(
      parse(unescapeWoodpeckerYaml(emitWorkflow(verify, TEST_IDENTITY))),
    );
    expect(ordinary.clone?.map((entry) => entry.name)).toEqual([
      "clear-golden",
      "clone",
      "finalize-clone",
    ]);

    const clearGolden = ordinary.clone?.[0];
    const finalizeOrdinary = ordinary.clone?.[2];
    expect(clearGolden?.image).toBe(SOURCE_CACHE_PREPARATION_IMAGE);
    expect(clearGolden?.commands).toEqual([
      "if [ -e .ci-golden ]; then find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +; fi",
      "chown 0:0 .",
    ]);
    expect(clearGolden?.backend_options.kubernetes.securityContext).toEqual({
      runAsUser: 0,
      runAsGroup: 0,
      allowPrivilegeEscalation: false,
    });

    expect(finalizeOrdinary?.image).toBe(SOURCE_CACHE_PREPARATION_IMAGE);
    expect(finalizeOrdinary?.volumes).toBeUndefined();
    expect(finalizeOrdinary?.commands).toEqual([
      "test -d .git",
      "test ! -L .git",
      "chown 0:0 . .git",
    ]);
    expect(
      finalizeOrdinary?.backend_options.kubernetes.securityContext,
    ).toEqual({
      runAsUser: 0,
      runAsGroup: 0,
      allowPrivilegeEscalation: false,
    });

    const cachedSteps = cacheSourceSteps([verify], {
      enabled: true,
      credentialless: false,
      main: true,
      image: `docker.io/shepherdjerred/woodpecker-config-extension@sha256:${"a".repeat(64)}`,
    });
    const cachedVerify = cachedSteps[0];
    if (cachedVerify === undefined) throw new Error("Missing cached verify");
    const cached = EmittedCloneSchema.parse(
      parse(unescapeWoodpeckerYaml(emitWorkflow(cachedVerify, TEST_IDENTITY))),
    );
    expect(finalizeOrdinary).toEqual(cached.clone?.[2]);
  });

  test("omits clone steps for skipClone and local macOS workflows", () => {
    const verify = testPipelineSteps().find((step) => step.key === "verify");
    if (verify === undefined) throw new Error("Missing verify fixture");

    const skipCloneEmitted = EmittedCloneSchema.parse(
      parse(
        unescapeWoodpeckerYaml(
          emitWorkflow({ ...verify, skipClone: true }, TEST_IDENTITY),
        ),
      ),
    );
    expect(skipCloneEmitted.clone).toBeUndefined();

    const localEmitted = EmittedCloneSchema.parse(
      parse(
        unescapeWoodpeckerYaml(
          emitWorkflow({ ...verify, backend: "local" }, TEST_IDENTITY),
        ),
      ),
    );
    expect(localEmitted.clone).toBeUndefined();
  });
});
