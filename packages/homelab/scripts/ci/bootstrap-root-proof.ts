import {
  RootReleaseApplicationSchema,
  isVerifiedRootReleaseTermination,
} from "@shepherdjerred/ops-model/argocd-release-receipt.ts";

/** Only the prior operation is classified here; current root drift still requires the separate exact maintenance proof. */
export function bootstrapPriorRootTermination(value: unknown) {
  const app = RootReleaseApplicationSchema.parse(value);
  if (app.metadata.name !== "apps") return false;
  return isVerifiedRootReleaseTermination({
    ...app,
    status: { ...app.status, sync: { ...app.status.sync, status: "Synced" } },
  });
}
