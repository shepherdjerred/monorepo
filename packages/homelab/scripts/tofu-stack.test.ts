import { describe, expect, test } from "vitest";

import {
  buildTofuEnvironment,
  STACK_CREDENTIALS,
  type TofuStack,
} from "./tofu-stack.ts";

const STATE_SOURCES = [
  "SEAWEEDFS_STATE_ACCESS_KEY_ID",
  "SEAWEEDFS_STATE_SECRET_ACCESS_KEY",
];

const STACKS: readonly TofuStack[] = [
  "seaweedfs",
  "tailscale",
  "buildkite",
  "arr",
  "github",
  "cloudflare",
  "posthog",
];

const allProviderSources = new Set(
  Object.values(STACK_CREDENTIALS)
    .flat()
    .map(({ source }) => source),
);

describe("Buildkite OpenTofu credential contracts", () => {
  test.each(STACKS)(
    "%s requires only state plus its provider identity",
    (stack) => {
      const requested: string[] = [];
      buildTofuEnvironment(stack, (name) => {
        requested.push(name);
        return `${name}-value`;
      });
      const providerSources = STACK_CREDENTIALS[stack].map(
        ({ source }) => source,
      );

      expect(requested.toSorted()).toEqual(
        [...STATE_SOURCES, ...providerSources].toSorted(),
      );
    },
  );

  test.each(STACKS)(
    "%s strips every forbidden provider credential",
    (stack) => {
      const environment = buildTofuEnvironment(
        stack,
        (name) => `${name}-value`,
      );
      const allowedSources = new Set(
        STACK_CREDENTIALS[stack].map(({ source }) => source),
      );
      const forbiddenSources = [...allProviderSources].filter(
        (name) => !allowedSources.has(name),
      );

      expect(environment.unsetEnv).toEqual(
        expect.arrayContaining(forbiddenSources),
      );
      for (const source of forbiddenSources) {
        expect(environment.env[source]).toBeUndefined();
      }
    },
  );

  test("SeaweedFS local-exec provisioners use the deployment identity", async () => {
    const buckets = await Bun.file(
      new URL("../src/tofu/seaweedfs/buckets.tf", import.meta.url),
    ).text();
    const provisioners = [...buckets.matchAll(/provisioner "local-exec"/g)];
    const explicitEnvironments = [
      ...buckets.matchAll(/environment = local\.seaweedfs_deploy_environment/g),
    ];

    expect(explicitEnvironments).toHaveLength(provisioners.length);
  });

  test("operator environment provides both SeaweedFS identities", async () => {
    const operatorEnvironment = await Bun.file(
      new URL("../src/tofu/.env", import.meta.url),
    ).text();

    expect(operatorEnvironment).toContain(
      "AWS_ACCESS_KEY_ID=op://v64ocnykdqju4ui6j6pua56xw4/eyfsbfkxojth6ymr65l47yyfxy/SEAWEEDFS_STATE_ACCESS_KEY_ID",
    );
    expect(operatorEnvironment).toContain(
      "TF_VAR_seaweedfs_access_key_id=op://v64ocnykdqju4ui6j6pua56xw4/eyfsbfkxojth6ymr65l47yyfxy/SEAWEEDFS_DEPLOY_ACCESS_KEY_ID",
    );
    expect(operatorEnvironment).toContain(
      "TF_VAR_seaweedfs_secret_access_key=op://v64ocnykdqju4ui6j6pua56xw4/eyfsbfkxojth6ymr65l47yyfxy/SEAWEEDFS_DEPLOY_SECRET_ACCESS_KEY",
    );
  });
});
