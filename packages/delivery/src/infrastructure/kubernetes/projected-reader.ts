import { z } from "zod";
import type { DeliveryKubernetesReader } from "@shepherdjerred/ops-model/delivery-readers.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  KubernetesReadBoundError,
  KubernetesStatusError,
  KubernetesUnavailableError,
  kubernetesReadTarget,
  readProjectedKubernetes,
} from "./projected-identity.ts";

/** One Kubernetes API read; resolves null when the object does not exist. */
export type KubernetesRead = (path: string) => Promise<unknown>;

/** Socket failures of a Kubernetes API that is restarting or not yet listening. */
const TRANSPORT_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

const CodedErrorSchema = z.object({ code: z.string() });

function unavailable(error: unknown) {
  if (error instanceof KubernetesUnavailableError) return true;
  const coded = CodedErrorSchema.safeParse(error);
  return coded.success && TRANSPORT_CODES.has(coded.data.code);
}

/**
 * Why a projected read failed, for the API's log. Only the reader, the read's
 * path and typed, non-secret facts: never a body, a token or a free-form
 * message from an unknown error.
 */
export function reportFailedRead(reader: string, path: string, error: unknown) {
  const coded = CodedErrorSchema.safeParse(error);
  console.error(
    JSON.stringify({
      message: "delivery_kubernetes_read_failed",
      reader,
      path: kubernetesReadTarget(path),
      errorType: error instanceof Error ? error.name : typeof error,
      ...(coded.success ? { code: coded.data.code } : {}),
      ...(error instanceof KubernetesStatusError
        ? { status: error.status }
        : {}),
      ...(error instanceof KubernetesReadBoundError
        ? {
            bound: error.bound,
            received: error.received,
            ...(error.declared === undefined
              ? {}
              : { declared: error.declared }),
          }
        : {}),
    }),
  );
}

/**
 * Reads through one settlement reader's projected identity (D5, I2). A
 * Kubernetes API that does not answer is UNAVAILABLE, which a caller may
 * retry; an unavailable projection, a refused read or a response over its
 * bound pauses settlement. All keep ownership; none falls back to another
 * credential. Every failure is logged with the read it was, and a response
 * over its bound also says so, with its size, in the refusal.
 */
export function projectedReader(
  reader: Pick<DeliveryKubernetesReader, "name" | "directory">,
  read?: KubernetesRead,
  options: { bound?: number } = {},
): KubernetesRead {
  const readOnce: KubernetesRead =
    read ??
    ((path) => readProjectedKubernetes(reader.directory, path, options.bound));
  return async (path) => {
    try {
      return await readOnce(path);
    } catch (error) {
      reportFailedRead(reader.name, path, error);
      if (unavailable(error))
        throw new DeliveryError(
          "UNAVAILABLE",
          `The Kubernetes API did not answer the projected ${reader.name} read; retry once it serves`,
        );
      if (error instanceof KubernetesReadBoundError)
        throw new DeliveryError(
          "PAUSED",
          `Independent readback is unavailable; the projected ${reader.name} read of ${error.target} exceeded its ${String(error.bound)}-byte bound (${
            error.declared === undefined
              ? `stopped after ${String(error.received)} bytes`
              : `the response declares ${String(error.declared)} bytes`
          })`,
        );
      throw new DeliveryError(
        "PAUSED",
        `Independent readback is unavailable; the projected ${reader.name} identity is required`,
      );
    }
  };
}

/** Objects per page: at the 13 KiB a worker Deployment takes, a page is a quarter of its bound. */
export const KUBERNETES_PAGE_SIZE = 20;

const PageSchema = z.looseObject({
  metadata: z.looseObject({ continue: z.string().optional() }).optional(),
  items: z.array(z.record(z.string(), z.unknown())),
});

/**
 * Every object of one collection, read in pages (`limit` and `continue`)
 * through the same reader, so each response stays inside the reader's bound
 * however many objects exist. The API server serves every page of one list
 * from the resource version of its first, so the result is one consistent
 * snapshot. `maxItems` bounds the whole: a collection over it is refused,
 * never truncated.
 */
export async function listKubernetes(
  read: KubernetesRead,
  path: string,
  options: { maxItems: number; pageSize?: number },
): Promise<Record<string, unknown>[]> {
  const pageSize = options.pageSize ?? KUBERNETES_PAGE_SIZE;
  const items: Record<string, unknown>[] = [];
  let token: string | undefined;
  do {
    const query = new URLSearchParams({ limit: String(pageSize) });
    if (token !== undefined) query.set("continue", token);
    const page = PageSchema.parse(
      await read(`${path}${path.includes("?") ? "&" : "?"}${query.toString()}`),
    );
    items.push(...page.items);
    if (items.length > options.maxItems)
      throw new DeliveryError(
        "PAUSED",
        `Independent readback is unavailable; ${kubernetesReadTarget(path)} lists more than ${String(options.maxItems)} objects`,
      );
    const next = page.metadata?.continue;
    token = next === undefined || next === "" ? undefined : next;
  } while (token !== undefined);
  return items;
}
