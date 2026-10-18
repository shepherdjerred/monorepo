import {
  ForumStageSchema,
  ReleaseSchema,
  type ForumRelease,
  type ForumStage,
} from "./release-schema.ts";

function selected(key: string) {
  return `{{ required \`Delivery requires ${key}\` .Values.delivery.${key} }}`;
}

/** Production inventory contains policy only; exact selected inputs are required at render time. */
export function forumTemplateInputs(
  input: ForumStage | ForumRelease,
): ForumRelease {
  const stage = ForumStageSchema.safeParse(input);
  if (!stage.success) return ReleaseSchema.parse(input);
  return {
    ...stage.data,
    image: selected("image"),
    bundleKey: selected("bundleKey"),
    bundleSha256: selected("bundleSha256"),
    releaseId: selected("releaseId"),
    preUpgradeBackup: {
      bundleSha256: selected("previousBundleSha256"),
      xenforoVersion: selected("previousXenforoVersion"),
      runtimeImage: selected("previousRuntimeImage"),
    },
  };
}
