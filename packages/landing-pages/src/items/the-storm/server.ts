// Mirrors packages/storm-forum/config/forum.json and the docs join page.
export const server = {
  java: { address: "ts-mc.net", version: "26.2" },
  bedrock: { address: "mc.ts-mc.net", port: "30004" },
  discord: "https://discord.gg/TvTCcWnYUT",
  joinGuide: "https://docs.ts-mc.net/join/",
  docs: "https://docs.ts-mc.net/",
  forum: "https://ts-mc.net/",
  map: "https://bluemap.ts-mc.net/",
} as const;
