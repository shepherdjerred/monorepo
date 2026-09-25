import { Hono } from "hono";
import type { KeyObject } from "node:crypto";
import { ConfigExtensionRequestSchema } from "#src/schemas.ts";
import { authorizePipeline } from "#src/authorization.ts";
import { verifySignedRequest } from "#src/signature.ts";
import { emitWorkflows } from "#src/pipeline/emit.ts";
import { selectSteps } from "#src/pipeline/select.ts";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import { resolveCiImages, type ImageFetcher } from "#src/images.ts";

export type AppOptions = {
  /** Resolves Woodpecker's signing key; the caller caches it. */
  readonly publicKey: () => Promise<KeyObject>;
  /** Reads a committed file at a given commit. */
  readonly imageFetcher: ImageFetcher;
  /** Resolves the newest green commit on a branch. */
  readonly changedBase: (
    repoId: number,
    branch: string,
  ) => Promise<string | undefined>;
  /**
   * Resolves the newest commit whose images were built, pushed and pinned --
   * a stricter question than "last green", answered from per-workflow outcomes.
   */
  readonly imageReleaseBase: (
    repoId: number,
    branch: string,
  ) => Promise<string | undefined>;
};

export function createApp(options: AppOptions): Hono {
  const app = new Hono();

  app.get("/healthz", (context) => context.text("ok"));

  app.post("/ciconfig", async (context) => {
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
      console.warn(
        `refused pipeline for ${repo.name}: ${authorization.reason}`,
      );
      return context.json({ error: "actor is not permitted to run CI" }, 403);
    }

    const [images, changedBase, imageReleaseBase] = await Promise.all([
      resolveCiImages(pipeline.commit, options.imageFetcher),
      options.changedBase(repo.id, repo.default_branch),
      options.imageReleaseBase(repo.id, repo.default_branch),
    ]);
    const selected = selectSteps(
      buildPipelineSteps({ images, changedBase, imageReleaseBase }),
      {
        event: pipeline.event,
        branch: pipeline.branch,
        defaultBranch: repo.default_branch,
        changedFiles: pipeline.changed_files,
      },
    );

    return context.json({
      configs: emitWorkflows(selected, {
        commit: pipeline.commit,
        branch: pipeline.branch,
        linkUrl: pipeline.forge_url,
      }),
    });
  });

  return app;
}
