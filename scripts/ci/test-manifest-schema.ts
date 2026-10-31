import { z } from "zod";

/**
 * A workspace may split its steps into named groups that separate Turbo tasks
 * run through `run-ci-test.ts --group <name>`, so each group gets its own cache
 * key and dependencies. Either every step of a workspace has a group or none
 * does.
 */
const group = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/u)
  .optional();

const StepSchema = z.discriminatedUnion("runner", [
  z
    .object({
      runner: z.literal("vitest"),
      name: z.string().min(1).optional(),
      group,
      runtime: z.enum(["bun", "node"]).optional(),
      runtimeReason: z.string().min(1).optional(),
      runtimeArgs: z.array(z.string()).optional(),
      args: z.array(z.string()).optional(),
    })
    .strict(),
  z
    .object({
      runner: z.literal("go"),
      name: z.string().min(1).optional(),
      group,
      args: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      runner: z.literal("cargo"),
      name: z.string().min(1).optional(),
      group,
      args: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      runner: z.literal("dotnet"),
      name: z.string().min(1).optional(),
      group,
      args: z.array(z.string()).min(1),
      coverageConfig: z.string().min(1).optional(),
      mstest: z
        .object({
          parallel: z.boolean(),
          timeoutMs: z.number().int().positive(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      runner: z.literal("gradle"),
      name: z.string().min(1).optional(),
      group,
      args: z.array(z.string()).min(1),
    })
    .strict(),
  z
    .object({
      runner: z.literal("command"),
      name: z.string().min(1),
      group,
      command: z.array(z.string()).min(1),
    })
    .strict(),
]);

export const TestManifestSchema = z
  .object({
    $schema: z.literal("./ci-test-manifest.schema.json"),
    version: z.literal(2),
    workspaces: z.array(
      z
        .object({
          package: z.string().min(1),
          directory: z.string().min(1),
          defaultEnv: z.record(z.string(), z.string()).optional(),
          coverageAlways: z.boolean().optional(),
          steps: z
            .array(StepSchema)
            .min(1)
            .refine(
              (steps) =>
                steps.every((step) => step.group === undefined) ||
                steps.every((step) => step.group !== undefined),
              "either every step of a workspace has a group or none does",
            ),
          // Suites this reporting workspace deliberately does NOT run, each with
          // a rationale. Full reporting is test-only: suites needing service
          // containers or spawned sibling processes run in their dedicated
          // lanes, not here. Recorded so the scope=full claim is honest and so
          // assertExcludedSuitesAreUncovered can prove a step never runs them.
          excludedSuites: z
            .array(
              z
                .object({
                  path: z.string().min(1),
                  reason: z.string().min(1),
                })
                .strict(),
            )
            .min(1)
            .optional(),
        })
        .strict(),
    ),
    testlessWorkspaces: z.array(
      z
        .object({
          package: z.string().min(1),
          directory: z.string().min(1),
          reason: z.string().min(1),
        })
        .strict(),
    ),
    separateTests: z.array(
      z
        .object({
          package: z.string().min(1),
          directory: z.string().min(1),
          reason: z.string().min(1),
          localScripts: z
            .object({
              build: z.literal("build:local").optional(),
              test: z.literal("test:local"),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();

export type TestManifest = z.infer<typeof TestManifestSchema>;
export type TestStep = z.infer<typeof StepSchema>;
