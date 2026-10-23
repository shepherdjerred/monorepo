import { z } from "zod";
import { ImageComponentNameSchema } from "@shepherdjerred/ops-model/catalog-document-shape.ts";

/**
 * An `operator-run` target with no Application or stack (section 5, X13):
 * one host the operator changes by hand from outside the cluster, such as a
 * `cluster-nodes` node whose Talos and Kubernetes versions move together.
 * Its components are images acquired from the version catalog (the Talos
 * installer, the kubelet); the operator's attestations of the recipe's
 * stages are its only evidence, and nothing in the cluster acts on it.
 */
export const OperatorHostTargetSchema = z
  .strictObject({
    kind: z.literal("host"),
    /** The lock instance: one environment per host (T6). */
    instance: z.string().regex(/^host:[a-z0-9][a-z0-9.-]*$/u),
    components: z.array(ImageComponentNameSchema).min(1),
  })
  .refine(
    (target) => new Set(target.components).size === target.components.length,
    "A host target binds each component once",
  );
