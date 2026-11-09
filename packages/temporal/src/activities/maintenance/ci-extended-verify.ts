import { ciExtendedVerifyEnabled } from "#config/ci-extended-verify.ts";
import {
  CI_EXTENDED_VERIFY_PREFIX,
  extendedVerifyMessage,
  type ExtendedVerifyReceipt,
  type ExtendedVerifyRequest,
  type ExtendedVerifySubmission,
} from "#shared/ci-extended-verify.ts";
import {
  maintenanceAdmissionBusy,
  maintenanceApi,
  maintenancePipeline,
  MaintenancePipelineSchema,
  newestVerifiedMaintenanceSource,
  recentMaintenancePipelines,
  type MaintenancePipeline,
} from "./ci-maintenance-client.ts";

const required = (key: string): string => {
  const value = Bun.env[key];
  if (value === undefined || value === "")
    throw new Error(`${key} is required for CI extended verify`);
  return value;
};

function pipelineUrl(number: number): string {
  return `${required("WOODPECKER_URL")}/repos/${required("WOODPECKER_REPO_ID")}/pipeline/${number.toString()}`;
}

function receiptOf(pipeline: MaintenancePipeline): ExtendedVerifyReceipt {
  return {
    number: pipeline.number,
    url: pipelineUrl(pipeline.number),
    commit: pipeline.commit,
    status: pipeline.status,
    workflows: pipeline.workflows.map(({ name, state }) => ({ name, state })),
  };
}

/** Only an owner manual main pipeline carrying the nightly message is a receipt. */
function assertExtendedVerifyIdentity(
  pipeline: MaintenancePipeline,
  requestId?: string,
): MaintenancePipeline {
  const expected =
    requestId === undefined
      ? CI_EXTENDED_VERIFY_PREFIX
      : extendedVerifyMessage(requestId);
  if (
    pipeline.event !== "manual" ||
    pipeline.branch !== "main" ||
    !pipeline.message.includes(expected)
  )
    throw new Error("Extended verify receipt identity mismatch");
  return pipeline;
}

async function findExtendedVerifyPipeline(
  requestId: string,
): Promise<MaintenancePipeline | null> {
  const message = extendedVerifyMessage(requestId);
  const recent = await recentMaintenancePipelines("manual");
  const matches = recent.filter((pipeline) =>
    pipeline.message.includes(message),
  );
  if (matches.length > 1)
    throw new Error("Duplicate extended verify request receipts");
  const match = matches[0];
  return match === undefined
    ? null
    : assertExtendedVerifyIdentity(
        await maintenancePipeline(match.number),
        requestId,
      );
}

export const ciExtendedVerifyActivities = {
  /** The newest complete main build, which the extension also checks out. */
  async selectExtendedVerifySource(): Promise<string | null> {
    return (await newestVerifiedMaintenanceSource()) ?? null;
  },
  /**
   * One POST per request ID. A request that already has a receipt returns it
   * instead of submitting again; a running maintenance canary defers the run
   * so its measurements are not skewed. The Workflow gives this activity one
   * attempt: a lost response is read back by request ID, never resubmitted.
   */
  async submitExtendedVerify(
    request: ExtendedVerifyRequest,
  ): Promise<ExtendedVerifySubmission> {
    if (!(await ciExtendedVerifyEnabled()))
      return { kind: "skipped", reason: "disabled" };
    const existing = await findExtendedVerifyPipeline(request.requestId);
    if (existing !== null)
      return { kind: "submitted", receipt: receiptOf(existing) };
    if (await maintenanceAdmissionBusy())
      return {
        kind: "deferred",
        reason: "an owner canary or maintenance pipeline is active",
      };
    const response = MaintenancePipelineSchema.parse(
      await maintenanceApi("", {
        method: "POST",
        body: JSON.stringify({
          branch: "main",
          message: extendedVerifyMessage(request.requestId),
          variables: {
            CI_EXTENDED_REQUEST: request.requestId,
            CI_EXTENDED_SOURCE: request.source,
          },
        }),
      }),
    );
    return { kind: "submitted", receipt: receiptOf(response) };
  },
  async findExtendedVerifyReceipt(
    requestId: string,
  ): Promise<ExtendedVerifyReceipt | null> {
    const pipeline = await findExtendedVerifyPipeline(requestId);
    return pipeline === null ? null : receiptOf(pipeline);
  },
  async describeExtendedVerify(number: number): Promise<ExtendedVerifyReceipt> {
    return receiptOf(
      assertExtendedVerifyIdentity(await maintenancePipeline(number)),
    );
  },
};
export type CiExtendedVerifyActivities = typeof ciExtendedVerifyActivities;
