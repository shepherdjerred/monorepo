import { z } from "zod";
import type { Pipeline } from "#src/schemas.ts";
import type { CiImages } from "#src/images.ts";
import { buildPipelineSteps, verifyCommands } from "./steps.ts";
import { playwrightSteps } from "./lanes/playwright.ts";
import { diagnosticCommands } from "./diagnostics.ts";
import { cacheSourceSteps } from "./source-cache.ts";
import { performanceSteps } from "./performance.ts";
import { signRemoteCacheSteps } from "./turbo-cache.ts";
import {
  grantGradleBuildCache,
  withoutGradleBuildCache,
} from "./gradle-build-cache.ts";
import { RAM_SCRATCH } from "./ram-scratch.ts";
import {
  DISABLED_PERFORMANCE,
  type PerformanceOptions,
} from "#src/performance-config.ts";

const Request = z.object({
  profile: z.enum(["verify", "browser"]),
  variant: z.enum(["baseline", "candidate"]),
  cache: z.enum(["cold", "warm"]),
  source: z.string().regex(/^[a-f\d]{40}$/u),
  feature: z.enum([
    "incremental",
    "prepared",
    "formatting",
    "gradle",
    "copyfile",
    "scratch",
  ]),
});
export type BenchmarkRequest = z.infer<typeof Request> & {
  readonly main: boolean;
};

/** Exclusive signed owner request: never falls through to main release work. */
export function benchmarkRequest(
  pipeline: Pipeline,
  defaultBranch: string,
  owner: boolean,
): BenchmarkRequest | undefined {
  if (
    !Object.keys(pipeline.variables).some((key) =>
      key.startsWith("CI_BENCHMARK_"),
    )
  )
    return;
  const branchAllowed =
    pipeline.branch === defaultBranch ||
    pipeline.branch.startsWith("ci-canary/");
  if (
    !owner ||
    !branchAllowed ||
    pipeline.event !== "manual" ||
    pipeline.ref !== `refs/heads/${pipeline.branch}` ||
    Object.keys(pipeline.variables).some(
      (key) =>
        key.startsWith("TOFU_PLATFORM_") ||
        key.startsWith("CI_MAINTENANCE_") ||
        key.includes("CORPUS"),
    )
  )
    throw new Error(
      "Benchmark requires an exclusive owner manual request on main or a canary branch",
    );
  const request = Request.parse({
    profile: pipeline.variables["CI_BENCHMARK_PROFILE"],
    variant: pipeline.variables["CI_BENCHMARK_VARIANT"],
    cache: pipeline.variables["CI_BENCHMARK_CACHE"],
    source: pipeline.variables["CI_BENCHMARK_SOURCE"],
    feature: pipeline.variables["CI_BENCHMARK_FEATURE"],
  });
  if (request.source !== pipeline.commit)
    throw new Error("Benchmark source moved before dispatch");
  if (
    request.feature === "scratch" &&
    (request.profile !== "verify" || pipeline.branch === defaultBranch)
  )
    throw new Error("RAM scratch requires a verify canary branch");
  return { ...request, main: pipeline.branch === defaultBranch };
}

export function benchmarkSteps(
  images: CiImages,
  request: BenchmarkRequest,
  allowed: PerformanceOptions,
  trustedImage?: string,
): ReturnType<typeof buildPipelineSteps> {
  if (
    request.feature === "scratch" &&
    (request.profile !== "verify" || request.main)
  )
    throw new Error("RAM scratch requires a verify canary branch");
  const template =
    request.profile === "verify"
      ? buildPipelineSteps({ images, changedBase: undefined }).find(
          (step) => step.key === "verify",
        )
      : playwrightSteps(images, "", false)[0];
  if (template === undefined) throw new Error("Benchmark profile missing");
  const options = {
    ...DISABLED_PERFORMANCE,
    ...(request.variant === "candidate"
      ? { [request.feature]: allowed[request.feature] }
      : {}),
  };
  if (request.variant === "candidate" && !allowed[request.feature])
    throw new Error("Benchmark candidate is not enabled by rollout policy");
  const commands =
    request.profile === "verify"
      ? diagnosticCommands(
          "verify",
          verifyCommands({
            remoteCache: request.cache === "warm",
            publishHandoff: false,
          }),
        )
      : template.commands;
  const step = {
    ...template,
    ...(options.scratch
      ? { ramScratch: true, resources: RAM_SCRATCH.resources }
      : {}),
    commands,
    dependsOn: [],
    environment: {
      // A cold benchmark measures a build with no shared results, so it must
      // not load Gradle outputs either.
      ...(request.cache === "cold"
        ? withoutGradleBuildCache(template.environment)
        : template.environment),
      CI_CHANGED_BASE: "",
      CI_BENCHMARK_PROFILE: request.profile,
      CI_BENCHMARK_VARIANT: request.variant,
      CI_BENCHMARK_CACHE: request.cache,
      CI_BENCHMARK_SOURCE: request.source,
      CI_BENCHMARK_FEATURE: request.feature,
    },
  };
  const cached = cacheSourceSteps([step], {
    enabled: true,
    main: request.main,
    credentialless: false,
    image: trustedImage,
  }).map((candidate) => ({
    ...candidate,
    ...(candidate.sourceCache === undefined
      ? {}
      : {
          sourceCache: {
            ...candidate.sourceCache,
            cold: request.cache === "cold",
          },
        }),
  }));
  const trustDomain = request.main ? "trusted" : "pull-request";
  return grantGradleBuildCache(
    signRemoteCacheSteps(
      performanceSteps(cached, options, request.main, false),
      trustDomain,
    ),
    trustDomain,
  ).map((candidate) => ({
    ...candidate,
    commands: candidate.commands.map((command) =>
      request.cache === "cold"
        ? command.replaceAll(
            'export TURBO_CACHE="remote:rw"',
            'export TURBO_CACHE="local:r"',
          )
        : command,
    ),
  }));
}
