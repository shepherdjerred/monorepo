import forum from "../../../../storm-forum/config/forum.json";

const { java, bedrock } = forum.minecraft.connections;

// Addresses come from the forum's canonical connection data. The Java version
// and Discord invite have no shared data file, so `astro.config.ts` checks them
// against the server image and the docs at build time.
export const server = {
  java: { address: java.address, version: "26.2" },
  // Bedrock support follows the live Geyser build, so the page names no number.
  bedrock: {
    address: bedrock.host,
    port: String(bedrock.port),
    version: "latest version",
  },
  discord: "https://discord.gg/TvTCcWnYUT",
  joinGuide: "https://docs.ts-mc.net/join/",
  consoleGuide: "https://docs.ts-mc.net/join/#playing-on-a-console",
  docs: "https://docs.ts-mc.net/",
  forum: "https://ts-mc.net/",
  map: "https://bluemap.ts-mc.net/",
} as const;
