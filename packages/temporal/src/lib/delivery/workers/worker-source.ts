import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";

/** Source configuration stays private; only immutable identity and its digest enter evidence. */
export function workerSourceFingerprint(input: unknown): string {
  const source = z
    .object({
      metadata: z.object({
        uid: z.string().min(1),
        annotations: z.record(z.string(), z.string()).default({}),
      }),
      spec: z.object({
        source: z.record(z.string(), z.unknown()),
        destination: z.record(z.string(), z.unknown()).optional(),
      }),
    })
    .parse(input);
  const identity = {
    uid: source.metadata.uid,
    owner:
      source.metadata.annotations["delivery.shepherdjerred.com/environment"] ??
      null,
    spec: source.spec,
  };
  return createHash("sha256").update(canonicalJson(identity)).digest("hex");
}
