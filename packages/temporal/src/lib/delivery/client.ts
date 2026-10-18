import { ApplicationFailure } from "@temporalio/common";
import type { z } from "zod";
import { ApiErrorSchema } from "@shepherdjerred/delivery/contract";

/** Credential/bootstrap only. Deployment policy and selected inputs come from PostgreSQL. */
export async function deliveryRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const base = Bun.env["DELIVERY_API_URL"];
  const token = Bun.env["DELIVERY_EXECUTOR_TOKEN"];
  if (base === undefined || token === undefined || token.length === 0)
    throw ApplicationFailure.nonRetryable(
      "Delivery executor bootstrap is missing",
      "DeliveryBootstrapMissing",
    );
  const response = await fetch(
    new URL(`api/v1/${path}`, `${base.replace(/\/$/u, "")}/`),
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    // Never interpolate upstream bodies: configuration and credentials can be echoed.
    const message = `Delivery API ${path} returned HTTP ${response.status.toString()}`;
    const error = ApiErrorSchema.parse(await response.json()).error;
    if (["PAUSED", "BUSY"].includes(error.code))
      throw ApplicationFailure.nonRetryable(
        message,
        `DeliveryApi:${error.code}`,
      );
    if (response.status >= 400 && response.status < 500)
      throw ApplicationFailure.nonRetryable(
        message,
        `DeliveryApi:${error.code}`,
      );
    throw new Error(message);
  }
  return schema.parse(await response.json());
}
