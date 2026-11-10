import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod";
import { ApiErrorSchema } from "@shepherdjerred/delivery/contract";

export const DELIVERY_API_UNAVAILABLE = "DeliveryApiUnavailable";

/**
 * The API was unreachable or answered with a gateway status. Its own rollout
 * (D8) replaces the pod a step is polling, so a caller whose request is a
 * read or an idempotent write may wait this out with
 * {@link whileDeliveryApiUnavailable}; nothing else is classified this way.
 */
export class DeliveryApiUnavailableError extends Error {
  override readonly name = DELIVERY_API_UNAVAILABLE;
}

const UNAVAILABLE_CODES = new Set([
  "ConnectionRefused",
  "ConnectionClosed",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
]);

const CodedErrorSchema = z.object({ code: z.string() });

function transportFailure(error: unknown) {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException) return error.name === "TimeoutError";
  const coded = CodedErrorSchema.safeParse(error);
  return coded.success && UNAVAILABLE_CODES.has(coded.data.code);
}

async function errorEnvelope(response: Response) {
  try {
    return ApiErrorSchema.safeParse(await response.json());
  } catch {
    return ApiErrorSchema.safeParse(null);
  }
}

/**
 * Delivery's own answers keep their meaning: it refuses with its error
 * envelope, a paused API with HTTP 503 `PAUSED` included. A 5xx without
 * that envelope, from whatever stands in front of a pod that is not serving,
 * is the API being unavailable, as is Delivery's own `UNAVAILABLE`: a
 * dependency it reads through, such as the Kubernetes API, did not answer.
 * Never interpolate upstream bodies: configuration and credentials can be
 * echoed.
 */
async function failedResponse(path: string, response: Response) {
  const message = `Delivery API ${path} returned HTTP ${response.status.toString()}`;
  const parsed = await errorEnvelope(response);
  if (!parsed.success)
    return response.status >= 500
      ? new DeliveryApiUnavailableError(message)
      : new Error(message);
  const { code } = parsed.data.error;
  if (code === "UNAVAILABLE")
    return new DeliveryApiUnavailableError(`${message} (UNAVAILABLE)`);
  const refused =
    ["PAUSED", "BUSY"].includes(code) ||
    (response.status >= 400 && response.status < 500);
  return refused
    ? ApplicationFailure.nonRetryable(message, `DeliveryApi:${code}`)
    : new Error(message);
}

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
  let response: Response;
  try {
    response = await fetch(
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
  } catch (error) {
    if (!transportFailure(error)) throw error;
    throw new DeliveryApiUnavailableError(
      `Delivery API ${path} is unreachable`,
      { cause: error },
    );
  }
  if (!response.ok) throw await failedResponse(path, response);
  return schema.parse(await response.json());
}

export type UnavailableWait = {
  /** Attempts before the last unavailability is rethrown. */
  readonly attempts: number;
  readonly intervalMs: number;
  /** Runs before each wait, such as an Activity heartbeat. */
  readonly onWait?: (attempt: number) => void;
};

/** About two minutes: an API rollout, not an outage, fits inside it. */
export const DELIVERY_API_UNAVAILABLE_WAIT: UnavailableWait = {
  attempts: 24,
  intervalMs: 5000,
};

/**
 * Repeats `operation` while the API is unavailable, up to the bounded wait.
 * Use it only for reads and for writes the server accepts again unchanged;
 * every other failure, and an unavailability that outlasts the wait,
 * propagates as before.
 */
export async function whileDeliveryApiUnavailable<T>(
  operation: () => Promise<T>,
  wait: UnavailableWait = DELIVERY_API_UNAVAILABLE_WAIT,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof DeliveryApiUnavailableError)) throw error;
      if (attempt >= wait.attempts) throw error;
      wait.onWait?.(attempt);
      await new Promise((resolve) => setTimeout(resolve, wait.intervalMs));
    }
  }
}
