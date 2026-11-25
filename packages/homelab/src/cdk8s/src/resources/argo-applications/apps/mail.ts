import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";
import { MAIL_ACTIVE } from "@shepherdjerred/homelab/cdk8s/src/resources/mail/index.ts";

export function createMailApp(chart: Chart, active = MAIL_ACTIVE) {
  if (!active) return;
  return createFirstPartyApplication(chart, {
    name: "mail",
    namespace: "mail",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
