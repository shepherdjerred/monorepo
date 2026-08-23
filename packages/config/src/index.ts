import {
  createResolver,
  type DescribedKey,
  type Resolver,
  type ResolverOptions,
} from "@shepherdjerred/config/resolver.ts";
import type { ConfigKeyDefinition } from "@shepherdjerred/config/definition.ts";

/**
 * Layered configuration: `flag → env → file → default`, behind one Zod-typed
 * call site.
 *
 * ## The rule that makes it correct
 *
 * Resolution falls through on **absence**, never on a resolved value. A source
 * that answers — including answering `false` — stops the waterfall. If a flag
 * turned off fell through, an env var still set to `true` would silently
 * re-enable exactly what an operator just disabled, and nothing in a normal
 * test run would show it.
 *
 * A source that *fails* is also not a source with no opinion: the failure is
 * reported through `onSourceError` and resolution continues, but an invalid
 * value that is present throws rather than deferring to a lower layer.
 *
 * ## Why this package does not depend on `@shepherdjerred/feature-flags`
 *
 * The `file` layer exists for apps we hand to other people, who have neither
 * Flipt nor Kubernetes env injection. If this package imported the flag client,
 * every distributed copy would carry a WASM engine it never loads. The flag
 * layer arrives as an injected `ConfigSource` instead, and the flags package
 * supplies the adapter.
 */
export function defineConfig<D extends Record<string, ConfigKeyDefinition>>(
  options: ResolverOptions<D>,
): Resolver<D> {
  return createResolver(options);
}

/**
 * Renders the startup dump: every key, its value, the layer that supplied it,
 * and the layers it was eligible for.
 *
 * Sensitive keys print a digest instead of a value. Without that, a credential
 * resolved through this package lands in stdout and then in Loki.
 */
export function formatConfigDump(keys: readonly DescribedKey[]): string {
  const lines = keys.map((entry) => {
    const shown = entry.sensitive
      ? `<redacted sha256:${entry.digest ?? ""}>`
      : JSON.stringify(entry.value);
    return `  ${entry.key} = ${shown}  [source: ${entry.source}; eligible: ${entry.eligible.join(" → ")}]`;
  });
  return ["resolved configuration:", ...lines].join("\n");
}
