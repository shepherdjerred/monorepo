import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import type { Principal } from "#shared/contract.ts";
import type { SourceCommitReport } from "./hub/source-commit.ts";

export function ciIdentity(
  ciUrl: string,
  allowedOrigin: string,
  repositoryId: number,
) {
  const url = new URL(ciUrl);
  const match = /^\/repos\/(\d+)\/pipeline\/(\d+)\/?$/.exec(url.pathname);
  if (
    url.origin !== new URL(allowedOrigin).origin ||
    match?.[1] === undefined ||
    match[2] === undefined ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new DeliveryError(
      "INVALID",
      "CI URL must reference an exact pipeline on the configured Woodpecker server",
    );
  const parsedRepositoryId = z.coerce.number().int().positive().parse(match[1]);
  if (parsedRepositoryId !== repositoryId)
    throw new DeliveryError(
      "INVALID",
      "CI pipeline belongs to a different repository",
    );
  return {
    repositoryId,
    pipelineNumber: z.coerce.number().int().positive().parse(match[2]),
  };
}

/**
 * Woodpecker serializes every field of its pipeline model, so `message` and
 * `author` are always present; either may be the empty string. The hub's CI
 * reader (`@shepherdjerred/ops-clients/woodpecker.ts`) requires the same two.
 */
const PipelineSchema = z.object({
  number: z.number().int(),
  commit: z.string(),
  message: z.string(),
  author: z.string(),
  branch: z.string(),
  event: z.string(),
  status: z.enum([
    "created",
    "pending",
    "blocked",
    "declined",
    "running",
    "success",
    "failure",
    "error",
    "killed",
    "canceled",
    "skipped",
  ]),
  finished: z.number().int(),
});
/** One build's CI qualification: what to verify, and who asked for it. */
export type QualificationRequest = {
  ciUrl: string;
  sourceRevision: string;
  /** The build being qualified. */
  buildId: string;
  /** The principal that asked for the qualification. */
  actor: Principal;
  /** The request it asked in. */
  requestId: string;
};

export function createQualifier(options: {
  origin: string;
  repositoryId: number;
  token: string | undefined;
  /**
   * Told what each exact main push pipeline says about its commit, whatever
   * the pipeline's status, so a commit whose CI is running or failed still
   * gets its title. Never called for a pipeline that fails the identity check.
   * The report names the build, principal and request of the qualification, so
   * the first record of a commit can be audited to them.
   */
  recordSourceCommit: (report: SourceCommitReport) => Promise<void>;
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
}) {
  return async (
    build: QualificationRequest,
  ): Promise<"pending" | "verified" | "failed"> => {
    if (options.token === undefined)
      throw new DeliveryError(
        "PAUSED",
        "CI qualification credentials are not configured",
      );
    const ci = ciIdentity(build.ciUrl, options.origin, options.repositoryId);
    const response = await fetchPipelineResponse(options, ci);
    if (!response.ok)
      throw new DeliveryError(
        "PAUSED",
        `CI qualification unavailable (${String(response.status)})`,
      );
    const raw: unknown = await response.json();
    const pipeline = PipelineSchema.parse(raw);
    if (
      pipeline.number !== ci.pipelineNumber ||
      pipeline.commit !== build.sourceRevision ||
      pipeline.branch !== "main" ||
      pipeline.event !== "push"
    )
      throw new DeliveryError(
        "INVALID",
        "Pipeline does not verify this exact main push revision",
      );
    await options.recordSourceCommit({
      sourceRevision: pipeline.commit,
      message: pipeline.message,
      author: pipeline.author,
      pipelineNumber: pipeline.number,
      buildId: build.buildId,
      actor: build.actor,
      requestId: build.requestId,
    });
    if (["created", "pending", "blocked", "running"].includes(pipeline.status))
      return "pending";
    return pipeline.status === "success" && pipeline.finished > 0
      ? "verified"
      : "failed";
  };
}

async function fetchPipelineResponse(
  options: {
    origin: string;
    token: string | undefined;
    fetch?: (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>;
  },
  ci: { repositoryId: number; pipelineNumber: number },
): Promise<Response> {
  try {
    return await (options.fetch ?? fetch)(
      new URL(
        `/api/repos/${String(ci.repositoryId)}/pipelines/${String(ci.pipelineNumber)}`,
        options.origin,
      ),
      {
        headers: {
          Authorization: `Bearer ${options.token ?? ""}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      },
    );
  } catch (error) {
    throw new DeliveryError(
      "PAUSED",
      `CI qualification unavailable (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}
