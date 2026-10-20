import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import { WoodpeckerClient } from "@shepherdjerred/ops-clients/woodpecker.ts";
import { fetchCommitContext } from "@shepherdjerred/ops-clients/github-commit.ts";
import {
  argocdApplicationLink,
  githubCommitLink,
  woodpeckerPipelineLink,
} from "@shepherdjerred/ops-model/tool-links.ts";
import {
  CiRunSchema,
  SourceChangeSchema,
} from "#shared/hub/integration-contract.ts";
import type {
  ArgoRuntimeIntegration,
  CiRunIntegration,
  IntegrationSource,
  SourceChange,
  SourceChangeIntegration,
} from "#shared/hub/integration-contract.ts";
import type { Database } from "#infrastructure/database.ts";
import { required } from "#infrastructure/delivery-records.ts";
import {
  environment as readEnvironment,
  version,
} from "#infrastructure/delivery-data.ts";
import { createSnapshotCache } from "./cache.ts";
import { failure, unavailable } from "./integration.ts";
import { ciRun, isFinalRun } from "./woodpecker-run.ts";
import { readArgoRuntime } from "./argocd-runtime.ts";

/** A running pipeline changes quickly; a commit gains its PR once merged. */
const RUNNING_PIPELINE_TTL_MS = 10_000;
const UNMERGED_COMMIT_TTL_MS = 10 * 60_000;
const ARGO_MEMO_MS = 10_000;

export type EnrichmentOptions = {
  database: Database;
  enabledSources: () => Promise<string[]>;
  woodpecker: {
    origin: string;
    repositoryId: number;
    token?: string | undefined;
  };
  github: { owner: string; name: string; token?: string | undefined };
  argocd: { origin: string; token?: string | undefined };
  fetch?: Fetch;
  now?: () => Date;
};

/** Read-only enrichment from Woodpecker, GitHub, and ArgoCD. */
export function createEnrichment(options: EnrichmentOptions) {
  const transport = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const cache = createSnapshotCache(options.database, now);
  const argoMemo = new Map<
    string,
    { at: number; value: Promise<ArgoRuntimeIntegration> }
  >();

  async function gate(
    integration: IntegrationSource,
    token: string | undefined,
  ) {
    const enabled = await options.enabledSources();
    if (!enabled.includes(integration)) return "disabled";
    return token === undefined ? "not-configured" : null;
  }

  async function ci(buildId: string): Promise<CiRunIntegration> {
    const build = required(
      await options.database.build.findUnique({ where: { id: buildId } }),
      "Build",
    );
    if (build.pipelineNumber === null)
      return unavailable(
        "not-applicable",
        "This build was not produced by Woodpecker CI",
        [],
      );
    const links = [woodpeckerPipelineLink(build.pipelineNumber)];
    const blocked = await gate("woodpecker", options.woodpecker.token);
    if (blocked !== null)
      return unavailable(blocked, "Woodpecker enrichment is off", links);
    const client = new WoodpeckerClient({
      baseUrl: options.woodpecker.origin,
      token: options.woodpecker.token ?? "",
      repoId: options.woodpecker.repositoryId,
      fetch: transport,
    });
    const pipelineNumber = build.pipelineNumber;
    try {
      const snapshot = await cache({
        source: "woodpecker",
        key: `${String(options.woodpecker.repositoryId)}/${String(pipelineNumber)}`,
        ttlMs: RUNNING_PIPELINE_TTL_MS,
        fetch: async () => {
          const run = ciRun(await client.pipeline(pipelineNumber));
          return { payload: run, final: isFinalRun(run) };
        },
      });
      return {
        state: "available",
        data: CiRunSchema.parse(snapshot.payload),
        fetchedAt: snapshot.fetchedAt.toISOString(),
        links,
      };
    } catch (error) {
      return failure(error, links);
    }
  }

  async function sourceChange(
    buildId: string,
  ): Promise<SourceChangeIntegration> {
    const build = required(
      await options.database.build.findUnique({ where: { id: buildId } }),
      "Build",
    );
    if (build.sourceKind !== "ci")
      return unavailable(
        "not-applicable",
        "This build has no monorepo commit",
        [],
      );
    const sha = build.sourceRevision;
    const links = [githubCommitLink(sha)];
    const blocked = await gate("github", options.github.token);
    if (blocked !== null)
      return unavailable(blocked, "GitHub enrichment is off", links);
    try {
      const snapshot = await cache({
        source: "github",
        key: sha,
        ttlMs: UNMERGED_COMMIT_TTL_MS,
        fetch: async () => {
          const context = await fetchCommitContext({
            owner: options.github.owner,
            name: options.github.name,
            oid: sha,
            token: options.github.token ?? "",
            fetch: transport,
          });
          const change: SourceChange = {
            sha: context.oid,
            headline: context.headline,
            body: context.body,
            committedAt: new Date(context.committedAt).toISOString(),
            url: context.url,
            authorName: context.authorName ?? null,
            authorLogin: context.authorLogin ?? null,
            pullRequest:
              context.pullRequest === undefined
                ? null
                : {
                    number: context.pullRequest.number,
                    title: context.pullRequest.title,
                    url: context.pullRequest.url,
                    mergedAt:
                      context.pullRequest.mergedAt === undefined
                        ? null
                        : new Date(context.pullRequest.mergedAt).toISOString(),
                    authorLogin: context.pullRequest.authorLogin ?? null,
                  },
          };
          return { payload: change, final: change.pullRequest !== null };
        },
      });
      return {
        state: "available",
        data: SourceChangeSchema.parse(snapshot.payload),
        fetchedAt: snapshot.fetchedAt.toISOString(),
        links,
      };
    } catch (error) {
      return failure(error, links);
    }
  }

  async function readRuntime(
    environmentId: string,
  ): Promise<ArgoRuntimeIntegration> {
    const env = await readEnvironment(options.database, environmentId);
    if (env.application === null)
      return unavailable(
        "not-applicable",
        "This environment is not an ArgoCD application",
        [],
      );
    const links = [argocdApplicationLink(env.application)];
    const blocked = await gate("argocd", options.argocd.token);
    if (blocked !== null)
      return unavailable(blocked, "ArgoCD enrichment is off", links);
    try {
      const accepted =
        env.acceptedVersionSetRevisionId === null
          ? null
          : await version(options.database, env.acceptedVersionSetRevisionId);
      const data = await readArgoRuntime({
        origin: options.argocd.origin,
        token: options.argocd.token ?? "",
        application: env.application,
        accepted,
        fetch: transport,
      });
      return {
        state: "available",
        data,
        fetchedAt: now().toISOString(),
        links,
      };
    } catch (error) {
      return failure(error, links);
    }
  }

  /** Live state is not persisted; a short memo bounds ArgoCD load. */
  function runtime(environmentId: string) {
    const at = now().getTime();
    const memo = argoMemo.get(environmentId);
    if (memo !== undefined && at - memo.at < ARGO_MEMO_MS) return memo.value;
    const value = (async () => {
      try {
        return await readRuntime(environmentId);
      } catch (error) {
        argoMemo.delete(environmentId);
        throw error;
      }
    })();
    argoMemo.set(environmentId, { at, value });
    return value;
  }

  return { ci, source: sourceChange, runtime };
}
export type Enrichment = ReturnType<typeof createEnrichment>;
