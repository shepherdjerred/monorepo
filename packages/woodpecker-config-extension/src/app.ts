import { Hono, type Context } from "hono";
import type { KeyObject } from "node:crypto";
import { ConfigExtensionRequestSchema, type Pipeline } from "#src/schemas.ts";
import { authorizePipeline } from "#src/authorization.ts";
import { verifySignedRequest } from "#src/signature.ts";
import { emitWorkflows } from "#src/pipeline/emit.ts";
import { isWorkEvent, selectSteps } from "#src/pipeline/select.ts";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import {
  PlatformApplyStackSchema,
  type PlatformOperation,
} from "#src/pipeline/lanes/tofu-apply.ts";
import { completionStep, noWorkStep } from "#src/pipeline/completion.ts";
import { resolveCiImages, type ImageFetcher } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { changedFilesSince } from "#src/github-compare.ts";
import {
  internalImagePinSteps,
  isInternalImagePinChange,
} from "#src/pipeline/internal-image-pin-change.ts";
import { signRemoteCacheSteps } from "#src/pipeline/turbo-cache.ts";
import { routeSteps } from "#src/pipeline/routing.ts";
import { groupTofuSteps } from "#src/pipeline/group-tofu.ts";
import { isPrVerificationEvent, prStatusEvent } from "#src/pr-event.ts";
import { limitedPrSteps } from "#src/pipeline/draft.ts";
import {
  maintenanceMode,
  requestedMaintenanceSteps,
  separateMaintenance,
} from "#src/pipeline/maintenance.ts";
import type { SuccessfulWorkflowPipeline } from "#src/woodpecker-api.ts";
import { cacheSourceSteps } from "#src/pipeline/source-cache.ts";

export type AppOptions = {
  readonly maintenanceEnabled?: (manual: boolean) => Promise<boolean>;
  readonly sourceCacheEnabled?: (branch: string) => Promise<boolean>;
  readonly trustedGateImage?: string;
  /** Resolves Woodpecker's signing key; the caller caches it. */
  readonly publicKey: () => Promise<KeyObject>;
  /** Reads a committed file at a given commit. */
  readonly imageFetcher: ImageFetcher;
  /** Resolves the newest green commit on a branch. */
  readonly changedBase: (
    repoId: number,
    branch: string,
  ) => Promise<string | undefined>;
  readonly verifyBase: (
    repoId: number,
    branch: string,
  ) => Promise<string | undefined>;
  /**
   * Resolves the newest pipeline with successful image and pin handoffs. Its
   * commit scopes builds; its number addresses pins not yet merged into main.
   */
  readonly imageReleaseBase: (
    repoId: number,
    branch: string,
  ) => Promise<SuccessfulWorkflowPipeline | undefined>;
  readonly compareChangedFiles?: typeof changedFilesSince;
  /** Checks an exact hosted-automation head against forge review state. */
  readonly hostedAutomationApproved?: (pipeline: Pipeline) => Promise<boolean>;
  /** Best-effort capacity cleanup; never substitutes for current-head gates. */
  readonly cancelSupersededPr?: (
    repoId: number,
    pipeline: Pipeline,
  ) => Promise<unknown>;
};

function platformOperationRequest(
  pipeline: Pipeline,
  defaultBranch: string,
):
  | { readonly operation: PlatformOperation }
  | { readonly invalid: true }
  | undefined {
  const prepare = pipeline.variables["TOFU_PLATFORM_PLAN"];
  const apply = pipeline.variables["TOFU_PLATFORM_APPLY"];
  const sourcePipeline = pipeline.variables["TOFU_PLATFORM_PLAN_PIPELINE"];
  if (
    prepare === undefined &&
    apply === undefined &&
    sourcePipeline === undefined
  ) {
    return undefined;
  }
  if (pipeline.event !== "manual" || pipeline.branch !== defaultBranch) {
    return { invalid: true };
  }
  if (
    prepare !== undefined &&
    apply === undefined &&
    sourcePipeline === undefined
  ) {
    const parsed = PlatformApplyStackSchema.safeParse(prepare);
    return parsed.success
      ? { operation: { stack: parsed.data, action: "prepare" } }
      : { invalid: true };
  }
  if (
    apply !== undefined &&
    prepare === undefined &&
    sourcePipeline !== undefined
  ) {
    const parsed = PlatformApplyStackSchema.safeParse(apply);
    if (
      parsed.success &&
      /^[1-9]\d*$/u.test(sourcePipeline) &&
      Number.isSafeInteger(Number(sourcePipeline))
    ) {
      return {
        operation: {
          stack: parsed.data,
          action: "apply-saved",
          sourcePipeline,
        },
      };
    }
  }
  return { invalid: true };
}

async function stepsForMainChange({
  steps,
  pipeline,
  defaultBranch,
  changedFiles,
  changedBase,
  imageFetcher,
}: {
  steps: CiStep[];
  pipeline: Pipeline;
  defaultBranch: string;
  changedFiles: readonly string[] | undefined;
  changedBase: string | undefined;
  imageFetcher: ImageFetcher;
}): Promise<CiStep[]> {
  return changedFiles !== undefined &&
    pipeline.event === "push" &&
    pipeline.branch === defaultBranch &&
    (await isInternalImagePinChange(
      changedFiles,
      changedBase,
      pipeline.commit,
      imageFetcher,
    ))
    ? internalImagePinSteps(steps)
    : steps;
}

async function needsCredentiallessHostedAutomation(
  actorClass: "owner-controlled" | "hosted-automation",
  pipeline: Pipeline,
  approvalCheck: AppOptions["hostedAutomationApproved"],
): Promise<boolean> {
  if (actorClass !== "hosted-automation" || !isPrVerificationEvent(pipeline)) {
    return false;
  }
  try {
    return (await approvalCheck?.(pipeline)) !== true;
  } catch (error) {
    console.warn("hosted automation approval lookup failed", error);
    return true;
  }
}

async function resolveChangedFiles({
  pipeline,
  repoName,
  defaultBranch,
  changedBase,
  compare,
}: {
  pipeline: Pipeline;
  repoName: string;
  defaultBranch: string;
  changedBase: string | undefined;
  compare: typeof changedFilesSince;
}): Promise<readonly string[] | undefined> {
  if (pipeline.event !== "push" || pipeline.branch !== defaultBranch) {
    return pipeline.changed_files;
  }
  return changedBase === undefined
    ? undefined
    : compare(`shepherdjerred/${repoName}`, changedBase, pipeline.commit);
}

async function cleanupSupersededPr(
  options: AppOptions,
  repoId: number,
  pipeline: Pipeline,
  credentialless = false,
): Promise<void> {
  if (credentialless || !isPrVerificationEvent(pipeline)) return;
  try {
    await options.cancelSupersededPr?.(repoId, pipeline);
  } catch {
    // An external cleanup failure must not suppress the replacement run.
    console.warn(
      "PR supersession cleanup failed; preserving full verification",
    );
  }
}

async function pipelineEmitter(
  options: AppOptions,
  pipeline: Pipeline,
  defaultBranch: string,
  credentialless: boolean,
) {
  const context = {
    event: isPrVerificationEvent(pipeline) ? "pull_request" : pipeline.event,
    branch: pipeline.branch,
    defaultBranch,
    draft: pipeline.pr_draft,
    maintenance: pipeline.variables["CI_MAINTENANCE_KIND"] !== undefined,
    changedFiles: pipeline.changed_files,
  };
  let enabled = false;
  if (!credentialless && isWorkEvent(context)) {
    const sourceBranch =
      pipeline.refspec === ""
        ? pipeline.branch
        : pipeline.refspec.split(":")[0];
    if (sourceBranch === undefined || sourceBranch === "")
      throw new Error("Invalid source branch refspec");
    enabled = (await options.sourceCacheEnabled?.(sourceBranch)) === true;
  }
  const identity = {
    commit: pipeline.commit,
    branch: pipeline.branch,
    linkUrl: pipeline.forge_url,
    event: pipeline.event,
  };
  return (steps: readonly CiStep[]) =>
    emitWorkflows(
      routeSteps(
        cacheSourceSteps(steps, {
          enabled,
          credentialless,
          main:
            ["push", "manual"].includes(pipeline.event) &&
            pipeline.branch === defaultBranch,
          image: options.trustedGateImage,
        }),
        context,
        options.trustedGateImage,
      ),
      identity,
    );
}

async function authenticatedRequest(context: Context, options: AppOptions) {
  // Verify against the exact bytes that were signed, not a re-serialization
  // of the parsed object.
  const body = await context.req.text();

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(context.req.header())) {
    headers[name.toLowerCase()] = value;
  }

  const verified = await verifySignedRequest(
    { method: context.req.method, url: context.req.url, headers, body },
    await options.publicKey(),
  );
  if (!verified) {
    // The response becomes an executed pipeline, so an unverified caller
    // learns nothing about why it was rejected.
    return context.json({ error: "invalid signature" }, 401);
  }

  const parsed = ConfigExtensionRequestSchema.safeParse(JSON.parse(body));
  if (!parsed.success) {
    return context.json({ error: "malformed request" }, 400);
  }

  const { repo, pipeline } = parsed.data;

  // Decided before any other work. A refusal must not be the 204 that means
  // "keep the configuration you already have", and it must not be a 200
  // carrying an empty set of configs either: this returns an error status so
  // the server marks the pipeline errored and schedules nothing. Refusing
  // first also keeps an untrusted commit from driving the forge reads below.
  const authorization = authorizePipeline(pipeline);
  if (!authorization.allowed) {
    console.warn(`refused pipeline for ${repo.name}: ${authorization.reason}`);
    return context.json({ error: "actor is not permitted to run CI" }, 403);
  }

  return { repo, pipeline, authorization };
}

export function createApp(options: AppOptions): Hono {
  const app = new Hono();
  const maintenanceEnabled =
    options.maintenanceEnabled ?? (() => Promise.resolve(false));
  const gateDirectory =
    options.trustedGateImage === undefined ? "/workspace" : "/app";
  app.get("/healthz", (context) => context.text("ok"));
  app.post("/ciconfig", async (context) => {
    const request = await authenticatedRequest(context, options);
    if (request instanceof Response) return request;
    const { repo, pipeline, authorization } = request;
    const maintenance = await maintenanceMode(
      pipeline,
      repo.default_branch,
      authorization.actorClass === "owner-controlled",
      maintenanceEnabled,
    );
    if ("error" in maintenance)
      return context.json({ error: maintenance.error }, maintenance.status);

    const platformOperation = platformOperationRequest(
      pipeline,
      repo.default_branch,
    );
    if (platformOperation !== undefined && "invalid" in platformOperation) {
      return context.json({ error: "invalid platform operation request" }, 400);
    }

    const prVerification = isPrVerificationEvent(pipeline);
    const selectionContext = {
      event: prVerification ? "pull_request" : pipeline.event,
      branch: pipeline.branch,
      defaultBranch: repo.default_branch,
      changedFiles: pipeline.changed_files,
    };
    const images = await resolveCiImages(pipeline.commit, options.imageFetcher);
    const credentiallessAutomation = await needsCredentiallessHostedAutomation(
      authorization.actorClass,
      pipeline,
      options.hostedAutomationApproved,
    );
    const emit = await pipelineEmitter(
      options,
      pipeline,
      repo.default_branch,
      credentiallessAutomation,
    );
    if (maintenance.kind !== undefined) {
      return context.json({
        configs: emit(
          requestedMaintenanceSteps(images, maintenance.kind, pipeline),
        ),
      });
    }
    if (!isWorkEvent(selectionContext)) {
      return context.json({
        configs: emit([noWorkStep(images.base)]),
      });
    }

    const limited = limitedPrSteps({
      images,
      pipeline,
      context: selectionContext,
      credentialless: credentiallessAutomation,
    });
    if (limited !== undefined) {
      const configs = emit(limited);
      await cleanupSupersededPr(
        options,
        repo.id,
        pipeline,
        credentiallessAutomation,
      );
      return context.json({ configs });
    }

    if (platformOperation !== undefined && "operation" in platformOperation) {
      const { operation } = platformOperation;
      const steps = buildPipelineSteps({
        images,
        changedBase: undefined,
        platformOperation: operation,
      }).filter(
        (step) =>
          step.key === "homelab-release-admission" ||
          step.key === `tofu-platform-${operation.stack}`,
      );
      const selected = selectSteps(steps, {
        ...selectionContext,
        changedFiles: [],
      });
      return context.json({ configs: emit(selected) });
    }

    const [changedBase, verifyBase, imageReleaseBase] = await Promise.all([
      options.changedBase(repo.id, repo.default_branch),
      options.verifyBase(repo.id, repo.default_branch),
      options.imageReleaseBase(repo.id, repo.default_branch),
    ]);
    const changedFiles = await resolveChangedFiles({
      pipeline,
      repoName: repo.name,
      defaultBranch: repo.default_branch,
      changedBase,
      compare: options.compareChangedFiles ?? changedFilesSince,
    });
    if (changedFiles === undefined) {
      console.warn(
        "could not establish complete main diff; selecting all lanes",
      );
    }
    const steps = buildPipelineSteps({
      images,
      trustedGateImage: options.trustedGateImage,
      changedBase,
      verifyBase,
      imageReleaseBase: imageReleaseBase?.commit,
      imageReleasePipeline: imageReleaseBase?.pipelineNumber,
    });
    const selected = groupTofuSteps(
      signRemoteCacheSteps(
        selectSteps(
          await stepsForMainChange({
            steps: maintenance.enabled ? separateMaintenance(steps) : steps,
            pipeline,
            defaultBranch: repo.default_branch,
            changedFiles,
            changedBase,
            imageFetcher: options.imageFetcher,
          }),
          { ...selectionContext, changedFiles: changedFiles ?? [] },
        ),
        prVerification ? "pull-request" : "trusted",
      ),
    );

    const configs = emit(
      prVerification
        ? [
            ...selected,
            completionStep(
              selected,
              options.trustedGateImage ?? images.base,
              gateDirectory,
              prStatusEvent(pipeline.event),
            ),
          ]
        : selected,
    );
    await cleanupSupersededPr(options, repo.id, pipeline);
    return context.json({ configs });
  });

  return app;
}
