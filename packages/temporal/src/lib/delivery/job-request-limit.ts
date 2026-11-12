import { ApplicationFailure } from "@temporalio/common";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  DeliveryJobRequestSchema,
  type DeliveryJobRequest,
} from "#shared/delivery-job.ts";

/**
 * Linux refuses to exec a process when one environment string, `NAME=value`
 * and its terminating NUL, exceeds MAX_ARG_STRLEN (32 pages: 131072 bytes);
 * the stage container then fails with "argument list too long". The Job
 * manifest passes the canonical request as `DELIVERY_JOB_REQUEST`.
 */
const MAX_ARG_STRLEN = 131_072;
const REQUEST_ENV = "DELIVERY_JOB_REQUEST";
export const DELIVERY_JOB_REQUEST_MAX_BYTES =
  MAX_ARG_STRLEN - `${REQUEST_ENV}=`.length - 1;

/** The UTF-8 size of the request a stage Job receives in its environment. */
export function deliveryJobRequestBytes(raw: DeliveryJobRequest): number {
  return Buffer.byteLength(canonicalJson(DeliveryJobRequestSchema.parse(raw)));
}

/**
 * Refuse, before any stage write or Job, a request the Job's container could
 * never exec: retrying the same frozen request cannot succeed.
 */
export function requireExecutableDeliveryJobRequest(
  raw: DeliveryJobRequest,
): void {
  const bytes = deliveryJobRequestBytes(raw);
  if (bytes > DELIVERY_JOB_REQUEST_MAX_BYTES)
    throw ApplicationFailure.nonRetryable(
      `Delivery Job request for ${raw.stageKey} is ${String(bytes)} bytes; its ${REQUEST_ENV} environment string exceeds the ${String(DELIVERY_JOB_REQUEST_MAX_BYTES)}-byte exec limit`,
      "DeliveryJobRequestTooLarge",
    );
}
