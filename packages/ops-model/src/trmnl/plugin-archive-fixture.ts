import { createHash } from "node:crypto";
import {
  TRMNL_PLUGIN_POLICY,
  TrmnlPluginBundleSchema,
  serializeTrmnlPluginBundle,
} from "./plugin-policy.ts";

/**
 * A valid stored bundle for the three fixed plugin targets and its
 * content-addressed `delivery-artifacts` identity, shared by tests on both
 * sides of the archive. A source revision selects the v1 schema that bound
 * its producer; without one the bundle is v2, identified by content alone.
 */
export function trmnlPluginArchiveFixture(sourceRevision?: string) {
  const plugins = TRMNL_PLUGIN_POLICY.plugins.map((target) => ({
    ...target,
    files: Object.fromEntries(
      TRMNL_PLUGIN_POLICY.files.map((name) => [
        name,
        name === "settings.yml"
          ? `id: ${String(target.id)}\nstrategy: polling\n`
          : `selected ${target.slug}/${name}\n`,
      ]),
    ),
  }));
  const bundle = TrmnlPluginBundleSchema.parse(
    sourceRevision === undefined
      ? { schema: "delivery-trmnl-plugins/v2", plugins }
      : { schema: "delivery-trmnl-plugins/v1", sourceRevision, plugins },
  );
  const bytes = new TextEncoder().encode(serializeTrmnlPluginBundle(bundle));
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return {
    bundle,
    bytes,
    digest,
    uri: `s3://delivery-artifacts/trmnl-plugins/${digest.slice(7)}.json`,
  };
}
