import type { Chart } from "cdk8s";
import {
  launcherRelease,
  LauncherReleaseSchema,
} from "@shepherdjerred/homelab/cdk8s/src/resources/glitter-boys-launcher/release.ts";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createGlitterBoysLauncherApp(
  chart: Chart,
  releaseState: unknown = launcherRelease,
) {
  if (LauncherReleaseSchema.parse(releaseState).stage === "prepared") return;
  return createFirstPartyApplication(chart, {
    name: "glitter-boys-launcher",
    namespace: "glitter-boys-launcher",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
