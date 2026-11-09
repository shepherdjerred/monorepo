import { Hono, type Context } from "hono";
import type { KeyObject } from "node:crypto";
import { ConfigExtensionRequestSchema, type Pipeline } from "#src/schemas.ts";
import { authorizePipeline } from "#src/authorization.ts";
import { verifySignedRequest } from "#src/signature.ts";
import { emitWorkflows } from "#src/pipeline/emit.ts";
import { isWorkEvent, selectSteps } from "#src/pipeline/select.ts";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import { completionStep } from "#src/pipeline/completion.ts";
import { resolveCiImages, type ImageFetcher } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { changedFilesSince } from "#src/github-compare.ts";
import { signRemoteCacheSteps } from "#src/pipeline/turbo-cache.ts";
import { grantGradleBuildCache } from "#src/pipeline/gradle-build-cache.ts";
import { routeSteps } from "#src/pipeline/routing.ts";
import { groupSmallChecks } from "#src/pipeline/group-small-checks.ts";
import { isPrVerificationEvent, prStatusEvent } from "#src/pr-event.ts";
import { limitedPrSteps } from "#src/pipeline/draft.ts";
import {
  maintenanceMode,
  eligibleMaintenanceSteps,
  maintenanceSourcePipeline,
  separateMaintenance,
} from "#src/pipeline/maintenance.ts";
import type { SuccessfulWorkflowPipeline } from "#src/woodpecker-api.ts";
import { cacheSourceSteps } from "#src/pipeline/source-cache.ts";
import { performanceSteps } from "#src/pipeline/performance.ts";
import { benchmarkResponse } from "#src/pipeline/benchmark-response.ts";
import {
  extendedRequest,
  extendedSourcePipeline,
  extendedSteps,
  extendedSupersededStep,
  isExtendedRequest,
  type ExtendedRequest,
} from "#src/pipeline/extended.ts";
import {
  DISABLED_PERFORMANCE,
  type PerformanceOptions,
} from "#src/performance-config.ts";

export type AppOptions = {
  readonly deliveryPublicationEnabled?: (branch: string) => Promise<boolean>;
  readonly deliveryCatalogV2Enabled?: (branch: string) => Promise<boolean>;
  readonly maintenanceEnabled?: (manual: boolean) => Promise<boolean>;
  /** Admits the owner's manual `CI_EXTENDED_REQUEST` pipeline; off by default. */
  readonly extendedVerifyEnabled?: () => Promise<boolean>;
  readonly sourceCacheEnabled?: (branch: string) => Promise<boolean>;
  readonly performanceOptions?: (branch: string) => Promise<PerformanceOptions>;
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
    extended: isExtendedRequest(pipeline),
    changedFiles: pipeline.changed_files,
  };
  let enabled = false;
  let performance = DISABLED_PERFORMANCE;
  if (!credentialless && isWorkEvent(context)) {
    const sourceBranch =
      pipeline.refspec === ""
        ? pipeline.branch
        : pipeline.refspec.split(":")[0];
    if (sourceBranch === undefined || sourceBranch === "")
      throw new Error("Invalid source branch refspec");
    enabled = (await options.sourceCacheEnabled?.(sourceBranch)) === true;
    performance =
      (await options.performanceOptions?.(sourceBranch)) ??
      DISABLED_PERFORMANCE;
  }
  const identity = {
    commit: pipeline.commit,
    branch: pipeline.branch,
    linkUrl: pipeline.forge_url,
    event: pipeline.event,
  };
  const emit = (steps: readonly CiStep[]) =>
    emitWorkflows(
      routeSteps(
        performanceSteps(
          cacheSourceSteps(steps, {
            enabled,
            credentialless,
            main:
              ["push", "manual"].includes(pipeline.event) &&
              pipeline.branch === defaultBranch,
            image: options.trustedGateImage,
          }),
          performance,
          ["push", "manual"].includes(pipeline.event) &&
            pipeline.branch === defaultBranch,
          credentialless,
        ),
        context,
        options.trustedGateImage,
      ),
      identity,
    );
  return Object.assign(emit, { performance, sourceCache: enabled });
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

function withPrCompletion(
  selected: CiStep[],
  options: AppOptions,
  pipeline: Pipeline,
  images: Awaited<ReturnType<typeof resolveCiImages>>,
) {
  if (!isPrVerificationEvent(pipeline)) return selected;
  return [
    ...selected,
    completionStep(
      selected,
      options.trustedGateImage ?? images.base,
      options.trustedGateImage === undefined ? "/workspace" : "/app",
      prStatusEvent(pipeline.event),
    ),
  ];
}

/**
 * Only the source-cache checkout fetches a commit other than the tip that
 * Woodpecker started; without it the request keeps the tip and is superseded.
 */
async function sourcePinnedEmitter(
  pipeline: Pipeline,
  candidate: Pipeline,
  build: (target: Pipeline) => ReturnType<typeof pipelineEmitter>,
) {
  if (candidate !== pipeline) {
    const emit = await build(candidate);
    if (emit.sourceCache) return { target: candidate, emit };
  }
  return { target: pipeline, emit: await build(pipeline) };
}

/**
 * The extended test tier's manual lane. The request names the verified main
 * commit it was selected for; the workflow runs against that commit when it is
 * still the verified one and can be checked out in place of the tip, and
 * otherwise emits a superseded receipt for the dispatcher to read.
 */
async function extendedVerifyResponse(
  context: Context,
  options: AppOptions,
  {
    repo,
    pipeline,
    owner,
    enabled,
  }: {
    repo: { id: number; default_branch: string };
    pipeline: Pipeline;
    owner: boolean;
    enabled: () => Promise<boolean>;
  },
) {
  if (!isExtendedRequest(pipeline)) return;
  if (!owner || !(await enabled()))
    return context.json(
      { error: "extended verification lane is not enabled for this request" },
      403,
    );
  let request: ExtendedRequest | undefined;
  try {
    request = extendedRequest(pipeline, repo.default_branch, owner);
  } catch {
    return context.json(
      { error: "invalid extended verification request" },
      400,
    );
  }
  if (request === undefined) return;
  const source = request.source;
  const { target, emit } = await sourcePinnedEmitter(
    pipeline,
    source === pipeline.commit
      ? pipeline
      : extendedSourcePipeline(
          pipeline,
          await options.changedBase(repo.id, repo.default_branch),
        ),
    (selected) =>
      pipelineEmitter(options, selected, repo.default_branch, false),
  );
  const images = await resolveCiImages(target.commit, options.imageFetcher);
  return context.json({
    configs: emit(
      target.commit === source
        ? extendedSteps(images, request)
        : [extendedSupersededStep(images.base)],
    ),
  });
}

export function createApp(options: AppOptions): Hono {
  const app = new Hono();
  const maintenanceEnabled =
    options.maintenanceEnabled ?? (() => Promise.resolve(false));
  const extendedVerifyEnabled =
    options.extendedVerifyEnabled ?? (() => Promise.resolve(false));
  const publishDelivery =
    options.deliveryPublicationEnabled ?? (() => Promise.resolve(false));
  const catalogV2 =
    options.deliveryCatalogV2Enabled ?? (() => Promise.resolve(false));
  app.get("/healthz", (context) => context.text("ok"));
  app.post("/ciconfig", async (context) => {
    const request = await authenticatedRequest(context, options);
    if (request instanceof Response) return request;
    const { repo, pipeline, authorization } = request;
    const benchmark = await benchmarkResponse(context, options, pipeline, {
      defaultBranch: repo.default_branch,
      owner: authorization.actorClass === "owner-controlled",
    });
    if (benchmark !== undefined) return benchmark;
    const extended = await extendedVerifyResponse(context, options, {
      repo,
      pipeline,
      owner: authorization.actorClass === "owner-controlled",
      enabled: extendedVerifyEnabled,
    });
    if (extended !== undefined) return extended;
    const maintenance = await maintenanceMode(
      pipeline,
      repo.default_branch,
      authorization.actorClass === "owner-controlled",
      maintenanceEnabled,
    );
    if ("error" in maintenance)
      return context.json({ error: maintenance.error }, maintenance.status);

    if (
      Object.keys(pipeline.variables).some((key) =>
        key.startsWith("TOFU_PLATFORM_"),
      )
    ) {
      return context.json(
        {
          error:
            "Infrastructure plan and apply operations run through Delivery",
        },
        400,
      );
    }

    const prVerification = isPrVerificationEvent(pipeline);
    const selectionContext = {
      event: prVerification ? "pull_request" : pipeline.event,
      branch: pipeline.branch,
      defaultBranch: repo.default_branch,
      changedFiles: pipeline.changed_files,
    };
    const credentiallessAutomation = await needsCredentiallessHostedAutomation(
      authorization.actorClass,
      pipeline,
      options.hostedAutomationApproved,
    );
    if (maintenance.kind !== undefined) {
      let verified: Promise<string | undefined> | undefined;
      const verifiedMain = () =>
        (verified ??= options.changedBase(repo.id, repo.default_branch));
      const source = pipeline.variables["CI_MAINTENANCE_SOURCE"];
      const { target, emit } = await sourcePinnedEmitter(
        pipeline,
        source === undefined || source === pipeline.commit
          ? pipeline
          : maintenanceSourcePipeline(pipeline, await verifiedMain()),
        (selected) =>
          pipelineEmitter(
            options,
            selected,
            repo.default_branch,
            credentiallessAutomation,
          ),
      );
      const images = await resolveCiImages(target.commit, options.imageFetcher);
      return context.json({
        configs: emit(
          await eligibleMaintenanceSteps(
            images,
            maintenance.kind,
            target,
            verifiedMain,
          ),
        ),
      });
    }
    // Tag, release, cron, closed-PR and feature-branch push events, and
    // ordinary PR metadata edits, select nothing. An empty configuration set
    // makes the server delete the pipeline before it takes an agent slot, a
    // workspace claim, a pod or a GitHub status; a refusal above stays an
    // error response and never becomes an empty 200. Decided before the forge
    // reads below, which such an event has no use for.
    if (!isWorkEvent(selectionContext)) {
      return context.json({ configs: [] });
    }

    const images = await resolveCiImages(pipeline.commit, options.imageFetcher);
    const emit = await pipelineEmitter(
      options,
      pipeline,
      repo.default_branch,
      credentiallessAutomation,
    );

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
      deliveryPublication: await publishDelivery(pipeline.branch),
      deliveryCatalogV2: await catalogV2(pipeline.branch),
      changedBase,
      verifyBase,
      imageReleaseBase: imageReleaseBase?.commit,
      imageReleasePipeline: imageReleaseBase?.pipelineNumber,
    }).map((step) => ({
      ...step,
      environment: { ...step.environment, CI_REPO_ID: String(repo.id) },
    }));
    const trustDomain = prVerification ? "pull-request" : "trusted";
    const selected = groupSmallChecks(
      grantGradleBuildCache(
        signRemoteCacheSteps(
          selectSteps(
            maintenance.enabled ? separateMaintenance(steps) : steps,
            { ...selectionContext, changedFiles: changedFiles ?? [] },
          ),
          trustDomain,
        ),
        trustDomain,
      ),
      emit.performance.grouping,
      prVerification,
      credentiallessAutomation,
    );

    const configs = emit(withPrCompletion(selected, options, pipeline, images));
    await cleanupSupersededPr(options, repo.id, pipeline);
    return context.json({ configs });
  });

  return app;
}
