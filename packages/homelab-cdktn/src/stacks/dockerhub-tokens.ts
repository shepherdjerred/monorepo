import type { Construct } from "constructs";
import { Op, TerraformIterator, TerraformOutput } from "cdktn";
import { AccessToken } from "#generated/providers/docker/access-token/index.ts";
import { DataDockerAccessTokens } from "#generated/providers/docker/data-docker-access-tokens/index.ts";
import { DataDockerLogin } from "#generated/providers/docker/data-docker-login/index.ts";
import { DockerProvider } from "#generated/providers/docker/provider/index.ts";
import { encryptStateAndPlans } from "#src/encryption.ts";
import { HomelabStack } from "#src/homelab-stack.ts";

const TOKENS = {
  management: { scopes: ["repo:read", "repo:write", "repo:admin"] },
  publisher: { scopes: ["repo:read", "repo:write"] },
  reader: { scopes: ["repo:read"] },
  renovate: { scopes: ["repo:read"] },
} as const;

/**
 * Operator-only: Docker Hub automation tokens, in their own encrypted state.
 * See `src/tofu/dockerhub-tokens/README.md`.
 */
export class DockerhubTokensStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "dockerhub-tokens", {
      requiredVersion: ">= 1.11.0",
      providerConstraints: { docker: "0.7.0" },
    });

    encryptStateAndPlans(this, {
      description: "Passphrase encrypting Docker Hub token state and plans.",
      errorMessage:
        "The state encryption passphrase must contain at least 16 characters.",
    });

    // Operator-only: use injected account credentials or the native account
    // login. A PAT can manage repositories but cannot create or manage other
    // PATs.
    new DockerProvider(this, "docker");

    // The account API read both proves token-management access and
    // initializes the provider's cached account username before docker_login
    // reads it.
    const account = new DataDockerAccessTokens(this, "account");
    const operator = new DataDockerLogin(this, "operator", {
      dependsOn: [account],
    });

    const tokens = TerraformIterator.fromMap(TOKENS);
    new AccessToken(this, "automation", {
      forEach: tokens,
      tokenLabel: `homelab-${tokens.key}`,
      scopes: tokens.getList("scopes"),
      lifecycle: {
        preventDestroy: true,
        precondition: [
          {
            condition: Op.eq(operator.username, "shepherdjerred"),
            errorMessage:
              "Sign into Docker Desktop as shepherdjerred before managing homelab tokens.",
          },
        ],
      },
    });

    // The HCL for-expression, verbatim: one entry per token instance.
    new TerraformOutput(this, "credentials", {
      description:
        "In-memory handoff to separate 1Password items; never print or save the decrypted output.",
      sensitive: true,
      value:
        "${{ for purpose, token in docker_access_token.automation : purpose => { username = data.docker_login.operator.username, token = token.token, uuid = token.uuid } }}",
    });
  }
}
