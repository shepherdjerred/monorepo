export const IMAGE_TARGET_OWNERS: Readonly<Record<string, string>> = {
  birmel: "@shepherdjerred/birmel",
  "tasknotes-server": "tasknotes-server",
  "starlight-karma-bot": "starlight-karma-bot",
  streambot: "@shepherdjerred/streambot",
  "temporal-worker": "@shepherdjerred/temporal",
  "trmnl-dashboard": "@shepherdjerred/trmnl-dashboard",
  "scout-for-lol": "@scout-for-lol/backend",
  "scout-evals": "@scout-for-lol/evals",
  "discord-plays-pokemon": "@discord-plays-pokemon/backend",
  "discord-plays-mario-kart": "@discord-plays-mario-kart/backend",
};

export const APPLICATION_IMAGE_TARGETS =
  Object.keys(IMAGE_TARGET_OWNERS).sort();

export const ALL_IMAGE_TARGETS = [...APPLICATION_IMAGE_TARGETS, "infra"].sort();
