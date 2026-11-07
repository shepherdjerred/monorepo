import { z } from "zod";

const HookAnnotationsSchema = z
  .object({
    metadata: z
      .object({
        annotations: z.record(z.string(), z.string()).optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const ARGO_HOOK_ANNOTATION = "argocd.argoproj.io/hook";
const ARGO_HOOK_DELETE_POLICY_ANNOTATION =
  "argocd.argoproj.io/hook-delete-policy";

/**
 * An Argo hook whose delete policy is BeforeHookCreation, or absent (Argo
 * then assumes it), is deleted and created again on every sync. Its live
 * object is never updated in place, so immutable fields cannot block it: a
 * completed hook Job whose stored template merely omits a defaulted field
 * (`hostNetwork: false`) stalled every temporal release on 2026-11-07. A
 * hook kept with another policy is still updated and keeps every check.
 */
export function targetIsRecreatedHook(
  target: Record<string, unknown>,
): boolean {
  const annotations = HookAnnotationsSchema.parse(target).metadata?.annotations;
  if (annotations?.[ARGO_HOOK_ANNOTATION] === undefined) return false;
  const policy = annotations[ARGO_HOOK_DELETE_POLICY_ANNOTATION];
  return (
    policy === undefined ||
    policy
      .split(",")
      .map((option) => option.trim())
      .includes("BeforeHookCreation")
  );
}
