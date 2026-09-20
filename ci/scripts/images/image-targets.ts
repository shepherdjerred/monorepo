type ImageTargetRegistration = {
  readonly owner: string;
  readonly ghcrVisibility: "public" | "external";
};

// This is the source of truth for first-party application image policy. Every
// target below is published under shepherdjerred on GHCR and must be public so
// the cluster can pull the immutable digest without registry credentials.
export const IMAGE_TARGET_REGISTRY: Readonly<
  Record<string, ImageTargetRegistration>
> = {
  "alert-dashboard": {
    owner: "@shepherdjerred/alert-dashboard",
    ghcrVisibility: "public",
  },
  birmel: { owner: "@shepherdjerred/birmel", ghcrVisibility: "public" },
  "openrouter-broadcast-ingest": {
    owner: "@shepherdjerred/openrouter-broadcast-ingest",
    ghcrVisibility: "public",
  },
  "tasknotes-server": { owner: "tasknotes-server", ghcrVisibility: "public" },
  "starlight-karma-bot": {
    owner: "starlight-karma-bot",
    ghcrVisibility: "public",
  },
  streambot: { owner: "@shepherdjerred/streambot", ghcrVisibility: "public" },
  "temporal-worker": {
    owner: "@shepherdjerred/temporal",
    ghcrVisibility: "public",
  },
  "trmnl-dashboard": {
    owner: "@shepherdjerred/trmnl-dashboard",
    ghcrVisibility: "public",
  },
  "scout-for-lol": {
    owner: "@scout-for-lol/backend",
    ghcrVisibility: "public",
  },
  "scout-evals": { owner: "@scout-for-lol/evals", ghcrVisibility: "public" },
  "discord-plays-pokemon": {
    owner: "@discord-plays-pokemon/backend",
    ghcrVisibility: "public",
  },
  "discord-plays-mario-kart": {
    owner: "@discord-plays-mario-kart/backend",
    ghcrVisibility: "public",
  },
} as const satisfies Readonly<Record<string, ImageTargetRegistration>>;

export const IMAGE_TARGET_OWNERS: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(IMAGE_TARGET_REGISTRY).map(([target, registration]) => [
      target,
      registration.owner,
    ]),
  );

export const FIRST_PARTY_PUBLIC_GHCR_PACKAGES = new Set(
  Object.entries(IMAGE_TARGET_REGISTRY)
    .filter(([, registration]) => registration.ghcrVisibility === "public")
    .map(([target]) => target),
);

export function requiresPublicGhcrVisibility(packageName: string): boolean {
  return FIRST_PARTY_PUBLIC_GHCR_PACKAGES.has(packageName);
}

export const APPLICATION_IMAGE_TARGETS =
  Object.keys(IMAGE_TARGET_OWNERS).sort();

export const ALL_IMAGE_TARGETS = [...APPLICATION_IMAGE_TARGETS, "infra"].sort();
