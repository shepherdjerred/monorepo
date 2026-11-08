import { z } from "zod";
import { CREDENTIAL_REGISTRY } from "#lib/credential-registry.ts";
import type { CredentialCache } from "#lib/credential-cache.ts";
import { defaultToolkitConfigPath } from "#lib/toolkit-config.ts";

/**
 * The `[credentials]` table of `~/.toolkit/config.toml`, and the operations
 * that need only locators: listing references and flushing cached reads.
 */

const CredentialOverridesFileSchema = z.looseObject({
  credentials: z.record(z.string(), z.unknown()).optional(),
});

export async function loadCredentialOverrides(
  configPath: string,
): Promise<Record<string, string>> {
  if (!(await Bun.file(configPath).exists())) {
    return {};
  }
  let document: unknown;
  try {
    document = Bun.TOML.parse(await Bun.file(configPath).text());
  } catch {
    throw new Error(
      `toolkit: failed to parse config file ${configPath}; private diagnostics withheld`,
    );
  }
  const table = CredentialOverridesFileSchema.parse(document).credentials ?? {};
  const overrides: Record<string, string> = {};
  for (const [key, entry] of Object.entries(table)) {
    if (typeof entry === "string" && entry.length > 0) {
      overrides[key] = entry;
    }
  }
  return overrides;
}

/** The `op://` reference a credential would be read from, if any. */
async function credentialRef(
  name: string,
  configPath: string,
): Promise<string | null> {
  const overrides = await loadCredentialOverrides(configPath);
  const override = overrides[name];
  if (override !== undefined) {
    return override.startsWith("op://") ? override : null;
  }
  const spec = CREDENTIAL_REGISTRY[name];
  return spec?.source.kind === "op" ? spec.source.ref : null;
}

/** Effective locators only; never reads credentials, caches, or ambient values. */
export async function credentialReferences(
  configPath = defaultToolkitConfigPath(),
) {
  const overrides = await loadCredentialOverrides(configPath);
  const names = [
    ...new Set([
      ...Object.keys(CREDENTIAL_REGISTRY),
      ...Object.keys(overrides),
    ]),
  ].toSorted();
  return names.flatMap((name) => {
    const override = overrides[name];
    const spec = CREDENTIAL_REGISTRY[name];
    const ref =
      override ?? (spec?.source.kind === "op" ? spec.source.ref : null);
    return ref?.startsWith("op://") === true
      ? [
          {
            name,
            ref,
            source: override === undefined ? "registry" : "override",
          },
        ]
      : [];
  });
}

/**
 * Drop cached service-account reads so the next use fetches from 1Password.
 * Without names, every registered credential is flushed. Returns the names
 * whose entries were removed.
 */
export async function flushCredentialCache(
  names: readonly string[],
  deps: { readonly cache: CredentialCache; readonly configPath?: string },
): Promise<string[]> {
  const configPath = deps.configPath ?? defaultToolkitConfigPath();
  const targets = names.length > 0 ? names : Object.keys(CREDENTIAL_REGISTRY);
  const flushed: string[] = [];
  for (const name of targets) {
    if (names.length > 0 && CREDENTIAL_REGISTRY[name] === undefined) {
      const overrides = await loadCredentialOverrides(configPath);
      if (overrides[name] === undefined) {
        throw new Error(`toolkit: unknown credential ${name}`);
      }
    }
    const ref = await credentialRef(name, configPath);
    if (ref !== null && (await deps.cache.delete(ref))) {
      flushed.push(name);
    }
  }
  return flushed;
}
