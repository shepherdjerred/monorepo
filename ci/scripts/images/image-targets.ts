type ImageTargetRegistration = {
  readonly owner: string;
};

// Build ownership lives here; registry visibility lives in image-registry.json.
export const IMAGE_TARGET_REGISTRY: Readonly<
  Record<string, ImageTargetRegistration>
> = {
  arcade: { owner: "@arcade/backend" },
  tracker: {
    owner: "@shepherdjerred/tracker",
  },
  media: { owner: "@shepherdjerred/media" },
  "alert-dashboard": {
    owner: "@shepherdjerred/alert-dashboard",
  },
  birmel: { owner: "@shepherdjerred/birmel" },
  "storm-brain": {
    owner: "@shepherdjerred/storm-brain",
  },
  "storm-forum": {
    owner: "@shepherdjerred/storm-forum",
  },
  "tasknotes-server": { owner: "tasknotes-server" },
  "starlight-karma-bot": {
    owner: "starlight-karma-bot",
  },
  streambot: { owner: "@shepherdjerred/streambot" },
  "temporal-worker": {
    owner: "@shepherdjerred/temporal",
  },
  "trmnl-dashboard": {
    owner: "@shepherdjerred/trmnl-dashboard",
  },
  "scout-for-lol": {
    owner: "@scout-for-lol/backend",
  },
  "discord-plays-pokemon": {
    owner: "@discord-plays-pokemon/backend",
  },
  "discord-plays-mario-kart": {
    owner: "@discord-plays-mario-kart/backend",
  },
  "woodpecker-config-extension": {
    owner: "@shepherdjerred/woodpecker-config-extension",
  },
} as const satisfies Readonly<Record<string, ImageTargetRegistration>>;

export const IMAGE_TARGET_OWNERS: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(IMAGE_TARGET_REGISTRY).map(([target, registration]) => [
      target,
      registration.owner,
    ]),
  );

export const APPLICATION_IMAGE_TARGETS =
  Object.keys(IMAGE_TARGET_OWNERS).sort();

export const INFRASTRUCTURE_IMAGE_TARGETS: readonly string[] = [
  "caddy-s3proxy",
  "obsidian-headless",
  "redlib",
  "the-storm-server",
  "velero-plugin",
];

export const ALL_IMAGE_TARGETS = [...APPLICATION_IMAGE_TARGETS, "infra"].sort();
