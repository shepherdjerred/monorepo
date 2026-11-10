/**
 * The one place an OpenTofu provider version is pinned.
 *
 * `src/tofu/provider-versions.json` is language-neutral: Renovate bumps it
 * through a regex manager, `packages/homelab-cdktn` generates its provider
 * bindings from it, and the stack runner builds the repository-owned AsusWRT
 * provider at the version it names. Each stack's `.terraform.lock.hcl` still
 * records what that stack runs; `providers:refresh` moves a lock to the pin.
 */
import path from "node:path";
import { z } from "zod";

export const PROVIDER_VERSIONS_PATH = path.resolve(
  import.meta.dir,
  "../../src/tofu/provider-versions.json",
);

const ProviderPinSchema = z.strictObject({
  /** Registry the provider is published to; its host is the address prefix. */
  registryUrl: z.url(),
  /** `<namespace>/<type>` in that registry. */
  source: z.string().regex(/^[\w-]+\/[\w-]+$/u),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  /** Generate TypeScript bindings; set when the first stack using it is ported. */
  bindings: z.boolean().optional(),
  /**
   * Directory name of the generated bindings when two providers share a type
   * (`openai/openai` and `jianyuan/openai`).
   */
  bindingsName: z.string().optional(),
  /** Built from this repository and served from a filesystem mirror. */
  local: z.boolean().optional(),
});

export type ProviderPin = z.infer<typeof ProviderPinSchema>;

const ProviderVersionsSchema = z
  .strictObject({ providers: z.array(ProviderPinSchema).min(1) })
  .refine(
    ({ providers }) =>
      new Set(providers.map((pin) => providerAddress(pin))).size ===
      providers.length,
    "every provider is pinned once",
  );

/** `registry.opentofu.org/integrations/github`, as lock files spell it. */
export function providerAddress(
  pin: Pick<ProviderPin, "registryUrl" | "source">,
): string {
  return `${new URL(pin.registryUrl).host}/${pin.source}`;
}

export async function loadProviderPins(
  file = PROVIDER_VERSIONS_PATH,
): Promise<ProviderPin[]> {
  return ProviderVersionsSchema.parse(await Bun.file(file).json()).providers;
}

/** The pin of one provider, by registry address; an unpinned provider is a broken contract. */
export function requirePin(
  pins: readonly ProviderPin[],
  address: string,
): ProviderPin {
  const pin = pins.find((candidate) => providerAddress(candidate) === address);
  if (pin === undefined)
    throw new Error(
      `Provider ${address} has no pin in src/tofu/provider-versions.json`,
    );
  return pin;
}

export type LockedProvider = {
  /** Registry address, as in {@link providerAddress}. */
  address: string;
  version: string;
};

/** Provider selections a `.terraform.lock.hcl` records. */
export function lockedProviders(lock: string): LockedProvider[] {
  const providers: LockedProvider[] = [];
  for (const match of lock.matchAll(
    /^provider "(?<address>[^"]+)" \{\s*version\s*=\s*"(?<version>[^"]+)"/gmu,
  )) {
    const { address, version } = match.groups ?? {};
    if (address !== undefined && version !== undefined)
      providers.push({ address, version });
  }
  return providers;
}
