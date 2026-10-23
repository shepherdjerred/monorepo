import type { DeliveryKubernetesReader } from "@shepherdjerred/ops-model/delivery-readers.ts";
import { DeliveryError } from "#domain/error.ts";
import { readProjectedKubernetes } from "./projected-identity.ts";

/** One Kubernetes API read; resolves null when the object does not exist. */
export type KubernetesRead = (path: string) => Promise<unknown>;

/**
 * Reads through one settlement reader's projected identity (D5, I2). An
 * unavailable projection or a refused read pauses settlement and keeps
 * ownership; it never falls back to another credential.
 */
export function projectedReader(
  reader: Pick<DeliveryKubernetesReader, "name" | "directory">,
  read: KubernetesRead = (path) =>
    readProjectedKubernetes(reader.directory, path),
): KubernetesRead {
  return async (path) => {
    try {
      return await read(path);
    } catch {
      throw new DeliveryError(
        "PAUSED",
        `Independent readback is unavailable; the projected ${reader.name} identity is required`,
      );
    }
  };
}
