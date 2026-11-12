import type { Construct } from "constructs";
import { Ruleset } from "#generated/providers/cloudflare/ruleset/index.ts";
import { TieredCache } from "#generated/providers/cloudflare/tiered-cache/index.ts";
import { FlattenedModule } from "#src/flattened-module.ts";

export type StaticCacheProps = {
  zoneId: string;
  /**
   * URL path prefixes (leading slash, such as `/_astro/`) that hold
   * content-hashed assets. The deploy uploads these with a one-year
   * `immutable` Cache-Control; the rule is scoped to them so the rest of the
   * zone is untouched.
   */
  assetPrefixes: readonly string[];
};

/**
 * Static-asset caching for a zone. It replaces the HCL module
 * `modules/static-cache`: both resources are root resources named `id`, and
 * `relocations` maps each from its `module.<id>` address.
 */
export class StaticCache extends FlattenedModule {
  constructor(scope: Construct, id: string, props: StaticCacheProps) {
    super(scope, id, `module.${id}`);
    if (props.assetPrefixes.length === 0)
      throw new Error(`${id}: assetPrefixes must contain at least one prefix.`);

    // Cache content-hashed assets per their origin Cache-Control (immutable,
    // one year). `respect_origin` for edge and browser TTL means the
    // immutable directive reaches browsers, which Cloudflare's default zone
    // Browser Cache TTL would otherwise clamp, but only for these prefixes:
    // mutable shells and HTML elsewhere keep their `no-cache` behavior.
    // Serving stale while revalidating shields users from the single-replica
    // origin's intermittent blips.
    this.place(
      new Ruleset(this, "static_asset_cache", {
        zoneId: props.zoneId,
        name: "static-asset-cache",
        kind: "zone",
        phase: "http_request_cache_settings",
        rules: [
          {
            ref: "immutable_hashed_assets",
            description:
              "Respect origin Cache-Control for content-hashed assets",
            expression: props.assetPrefixes
              .map(
                (prefix) => `starts_with(http.request.uri.path, "${prefix}")`,
              )
              .join(" or "),
            action: "set_cache_settings",
            actionParameters: {
              cache: true,
              edgeTtl: { mode: "respect_origin" },
              browserTtl: { mode: "respect_origin" },
              serveStale: { disableStaleWhileUpdating: false },
            },
          },
        ],
      }),
      id,
      "static_asset_cache",
    );

    // Smart Tiered Cache: funnel cache misses through an upper tier rather
    // than every edge hitting the origin, which raises the hit ratio and
    // shields the origin.
    this.place(
      new TieredCache(this, "smart", { zoneId: props.zoneId, value: "on" }),
      id,
      "smart",
    );
  }
}
