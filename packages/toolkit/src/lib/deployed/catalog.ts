/**
 * Service registry for `toolkit deployed`.
 *
 * Maps each deployable k8s service → its workspace package and one or more
 * variants (versionKey + ArgoCD app). This is a runtime-local table on purpose:
 * the compiled binary must NOT freeze a snapshot of versions.ts (which is read
 * live via git), but the package↔versionKey↔argoApp wiring changes rarely.
 *
 * A drift test (test/deployed/catalog.test.ts) cross-checks the package →
 * versionKey base pairs against IMAGE_PUSH_TARGETS / INFRA_PUSH_TARGETS in
 * scripts/ci/src/catalog.ts so this table can't silently fall out of sync.
 */
import type { Service, Variant } from "./types.ts";

const single = (
  alias: string,
  pkg: string,
  versionKey: string,
  argoApp: string,
): Service => ({
  alias,
  package: pkg,
  variants: [{ name: "default", versionKey, argoApp }],
});

export const SERVICES: Service[] = [
  single("birmel", "birmel", "shepherdjerred/birmel", "birmel"),
  single(
    "tasknotes-server",
    "tasknotes-server",
    "shepherdjerred/tasknotes-server",
    "tasknotes",
  ),
  {
    alias: "scout-for-lol",
    package: "scout-for-lol",
    variants: [
      {
        name: "beta",
        versionKey: "shepherdjerred/scout-for-lol/beta",
        argoApp: "scout-beta",
      },
      {
        name: "prod",
        versionKey: "shepherdjerred/scout-for-lol/prod",
        argoApp: "scout-prod",
      },
    ],
  },
  single(
    "discord-plays-pokemon",
    "discord-plays-pokemon",
    "shepherdjerred/discord-plays-pokemon",
    "pokemon",
  ),
  single(
    "discord-plays-mario-kart",
    "discord-plays-mario-kart",
    "shepherdjerred/discord-plays-mario-kart",
    "mario-kart",
  ),
  {
    alias: "starlight-karma-bot",
    package: "starlight-karma-bot",
    variants: [
      {
        name: "beta",
        versionKey: "shepherdjerred/starlight-karma-bot/beta",
        argoApp: "starlight-karma-bot-beta",
      },
      {
        name: "prod",
        versionKey: "shepherdjerred/starlight-karma-bot/prod",
        argoApp: "starlight-karma-bot-prod",
      },
    ],
  },
  single("streambot", "streambot", "shepherdjerred/streambot", "media"),
  single(
    "temporal-worker",
    "temporal",
    "shepherdjerred/temporal-worker",
    "temporal",
  ),
  single(
    "trmnl-dashboard",
    "trmnl-dashboard",
    "shepherdjerred/trmnl-dashboard",
    "trmnl-dashboard",
  ),
  // Infra images live under packages/homelab. obsidian-headless has no
  // dedicated ArgoCD app — it ships inside the umbrella `apps` chart; the pod
  // digest scan still matches it by image substring.
  single(
    "caddy-s3proxy",
    "homelab",
    "shepherdjerred/caddy-s3proxy",
    "s3-static-sites",
  ),
  single(
    "obsidian-headless",
    "homelab",
    "shepherdjerred/obsidian-headless",
    "apps",
  ),
];

/** Short, friendly aliases that map onto a canonical service alias. */
const ALIASES: Record<string, string> = {
  scout: "scout-for-lol",
  tasknotes: "tasknotes-server",
  karma: "starlight-karma-bot",
  starlight: "starlight-karma-bot",
  pokemon: "discord-plays-pokemon",
  "mario-kart": "discord-plays-mario-kart",
  streambot: "streambot",
  temporal: "temporal-worker",
  worker: "temporal-worker",
  trmnl: "trmnl-dashboard",
};

function findService(name: string): Service | null {
  const lower = name.toLowerCase();
  const canonical = ALIASES[lower] ?? lower;
  return (
    SERVICES.find((s) => s.alias === canonical) ??
    SERVICES.find((s) => s.package === canonical) ??
    null
  );
}

export type ServiceSelection = {
  service: Service;
  /** When set, restrict to this single variant. */
  variant: Variant | null;
};

/**
 * Resolve a CLI selector like "scout", "scout/prod", "scout-prod", "scout:prod"
 * to a service (and optional variant). Returns null if it isn't a known service.
 */
export function resolveServiceSelector(
  selector: string,
): ServiceSelection | null {
  // Try an explicit variant separator first: "scout/prod" or "scout:prod".
  const sep = /[/:]/.exec(selector);
  if (sep != null) {
    const base = selector.slice(0, sep.index);
    const variantName = selector.slice(sep.index + 1).toLowerCase();
    const service = findService(base);
    if (service == null) {
      return null;
    }
    const variant =
      service.variants.find((v) => v.name === variantName) ?? null;
    return variant == null ? null : { service, variant };
  }

  // Whole-string service match (covers "scout", "birmel", "tasknotes-server").
  const direct = findService(selector);
  if (direct != null) {
    return { service: direct, variant: null };
  }

  // Hyphenated argo-app form: "scout-prod", "starlight-karma-bot-beta".
  const dash = selector.lastIndexOf("-");
  if (dash > 0) {
    const tail = selector.slice(dash + 1).toLowerCase();
    if (tail === "beta" || tail === "prod") {
      const service = findService(selector.slice(0, dash));
      const variant = service?.variants.find((v) => v.name === tail) ?? null;
      if (service != null && variant != null) {
        return { service, variant };
      }
    }
  }

  return null;
}

/** Services whose package matches one of the given changed top-level packages. */
export function servicesForPackages(changed: Iterable<string>): Service[] {
  const set = new Set(changed);
  return SERVICES.filter((s) => set.has(s.package));
}
