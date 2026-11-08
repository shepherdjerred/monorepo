import { EnvValue, type ISecret } from "cdk8s-plus-31";
import type { Stage } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";

// Credential bootstrap only. Set a stage true after provisioning both fields
// and refreshing the vault snapshot. Product rollout belongs to Flipt.
export const SCOUT_RSO_PROVISIONED: Readonly<Record<Stage, boolean>> = {
  beta: false,
  prod: false,
};

export function riotRsoEnv(secret: ISecret): Record<string, EnvValue> {
  return {
    RIOT_RSO_CLIENT_ID: EnvValue.fromSecretValue({
      secret,
      key: "RIOT_RSO_CLIENT_ID",
    }),
    RIOT_RSO_CLIENT_SECRET: EnvValue.fromSecretValue({
      secret,
      key: "RIOT_RSO_CLIENT_SECRET",
    }),
  };
}
