import { createHash } from "node:crypto";

/** Node-only stable UUID shared by source-owned external operation adapters. */
export function deliveryOperationId(identity: string): string {
  const hash = createHash("sha256")
    .update(`delivery:${identity}:reconcile`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
