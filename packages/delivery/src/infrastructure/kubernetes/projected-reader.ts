import { z } from "zod";
import type { DeliveryKubernetesReader } from "@shepherdjerred/ops-model/delivery-readers.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  KubernetesUnavailableError,
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
 * Reads through one settlement reader's projected identity (D5, I2). A
 * Kubernetes API that does not answer is UNAVAILABLE, which a caller may
 * retry; an unavailable projection or a refused read pauses settlement.
 * Both keep ownership; neither falls back to another credential.
 */
export function projectedReader(
  reader: Pick<DeliveryKubernetesReader, "name" | "directory">,
  read: KubernetesRead = (path) =>
    readProjectedKubernetes(reader.directory, path),
): KubernetesRead {
  return async (path) => {
    try {
      return await read(path);
    } catch (error) {
      if (unavailable(error))
        throw new DeliveryError(
          "UNAVAILABLE",
          `The Kubernetes API did not answer the projected ${reader.name} read; retry once it serves`,
        );
      throw new DeliveryError(
        "PAUSED",
        `Independent readback is unavailable; the projected ${reader.name} identity is required`,
      );
    }
  };
}
