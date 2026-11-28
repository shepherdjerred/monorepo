import type { Construct } from "constructs";
import { S3Backend, TerraformStack } from "cdktn";
import { z } from "zod";
import providerVersionsDocument from "homelab/src/tofu/provider-versions.json" with { type: "json" };
import { requirePin } from "homelab/scripts/tofu/provider-versions.ts";
import { forget } from "#src/state-migrations.ts";

const PINNED_PROVIDERS = z
  .object({
    providers: z.array(
      z.looseObject({
        registryUrl: z.string(),
        source: z.string(),
        version: z.string(),
        bindings: z.boolean().optional(),
        bindingsName: z.string().optional(),
        local: z.boolean().optional(),
      }),
    ),
  })
  .parse(providerVersionsDocument).providers;

/**
 * Exact version pinned in `packages/homelab/src/tofu/provider-versions.json`
 * for `address` (e.g. `registry.opentofu.org/docker/docker`). Stacks whose
 * `.terraform.lock.hcl` constrains a provider to an exact version read it
 * here so `providers:refresh` advances both configuration and lock together.
 */
export function pinnedProviderVersion(address: string): string {
  return requirePin(PINNED_PROVIDERS, address).version;
}

/** OpenTofu releases the app, and the bindings generated for it, target. */
export const OPENTOFU_TARGET_VERSION = ">=1.11.0";

/** The SeaweedFS bucket every stack keeps its state in. */
export const STATE_BUCKET = "homelab-tofu-state";

/**
 * Tailscale (tailnet-only) instead of the Cloudflare tunnel: Cloudflare
 * rewrites Accept-Encoding headers, which breaks SigV4 signatures
 * (hashicorp/terraform#36412).
 */
export const STATE_ENDPOINT = "https://seaweedfs-s3.tailnet-1a49.ts.net";

export type HomelabStackOptions = {
  /** OpenTofu `required_version` constraint of the root module. */
  readonly requiredVersion: string;
  /**
   * Version constraint per provider local name, exactly as recorded in the
   * stack's `.terraform.lock.hcl`. Generated bindings would otherwise pin
   * the exact generated version, which rewrites the lock file's
   * `constraints` and fails `tofu init -lockfile=readonly`.
   */
  readonly providerConstraints: Readonly<Record<string, string>>;
};

/**
 * One OpenTofu root module under `packages/homelab/src/tofu/<id>`.
 *
 * Synthesis must keep every address identical to the stack's existing state:
 * constructs are created directly in this scope with their HCL names (the App
 * excludes the stack id from logical ids), so `new Repository(this,
 * "monorepo")` is `github_repository.monorepo`.
 */
export class HomelabStack extends TerraformStack {
  constructor(scope: Construct, id: string, options: HomelabStackOptions) {
    super(scope, id);

    new S3Backend(this, {
      bucket: STATE_BUCKET,
      key: `${id}/terraform.tfstate`,
      endpoints: { s3: STATE_ENDPOINT },
      region: "auto",
      skipCredentialsValidation: true,
      skipMetadataApiCheck: true,
      skipRegionValidation: true,
      skipRequestingAccountId: true,
      skipS3Checksum: true,
      usePathStyle: true,
      useLockfile: true,
    });

    this.addOverride("terraform.required_version", options.requiredVersion);
    for (const [provider, constraint] of Object.entries(
      options.providerConstraints,
    )) {
      this.addOverride(
        `terraform.required_providers.${provider}.version`,
        constraint,
      );
    }
  }

  /**
   * Forgets a resource without destroying it. Kept on the stack for the
   * stacks already written against it; it shares one list with `moved()` and
   * `retire()` in `state-migrations.ts`.
   */
  protected removeFromState(address: string): void {
    forget(this, address);
  }
}
