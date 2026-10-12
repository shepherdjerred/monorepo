import type { Chart } from "cdk8s";
import { Secret, type ISecret } from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

export const TEMPORAL_EXTERNAL_AUTH_SECRET = "temporal-external-auth";
// The server also runs history on 7234 in this Pod's shared network namespace.
export const TEMPORAL_EXTERNAL_GATEWAY_PORT = 17_233;
export const TEMPORAL_UI_UPSTREAM_PORT = 8081;

export const TEMPORAL_GRPC_GATEWAY_CONFIG = `{
  admin off
  auto_https off
  servers :${TEMPORAL_EXTERNAL_GATEWAY_PORT.toString()} {
    protocols h1 h2c
  }
}

:${TEMPORAL_EXTERNAL_GATEWAY_PORT.toString()} {
  @authenticated header Authorization "Bearer {$TEMPORAL_AUTH_TOKEN}"
  handle @authenticated {
    reverse_proxy h2c://127.0.0.1:7233
  }
  respond "authentication required" 401
}
`;

export const TEMPORAL_UI_GATEWAY_CONFIG = `{
  admin off
  auto_https off
}

:8080 {
  handle /health {
    respond "ok" 200
  }
  handle {
    basic_auth {
      operator {$TEMPORAL_UI_BASIC_HASH}
    }
    reverse_proxy 127.0.0.1:${TEMPORAL_UI_UPSTREAM_PORT.toString()}
  }
}
`;

export function createTemporalExternalAuthSecret(chart: Chart): ISecret {
  const item = new OnePasswordItem(
    chart,
    "temporal-external-auth-onepassword",
    {
      metadata: { name: TEMPORAL_EXTERNAL_AUTH_SECRET },
      spec: { itemPath: vaultItemPath("2x4fpii5zq4jbw3l2p2qkvjtiy") },
    },
  );
  return Secret.fromSecretName(
    chart,
    "temporal-external-auth-secret",
    item.name,
  );
}
