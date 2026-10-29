import forum from "../../../../storm-forum/config/forum.json";

const { java, bedrock } = forum.minecraft.connections;

// Addresses come from the forum's canonical connection data. The server's Java
// version and the Discord invite have no shared data file, so `astro.config.ts`
// checks them against the server image and the docs at build time.
export const server = {
  java: {
    address: java.address,
    // ViaBackwards admits clients older than the server's version.
    serverVersion: "26.3",
    versions: "26.3 & older",
    bestOn: "26.3",
  },
  // Bedrock support follows the live Geyser build, so the page names no number.
  bedrock: {
    address: bedrock.host,
    port: String(bedrock.port),
    version: "latest version",
  },
  discord: "https://discord.gg/TvTCcWnYUT",
  joinGuide: "https://docs.ts-mc.net/join/",
  // Consoles have no Add Server button; BedrockConnect's DNS method stands in.
  // The docs join page lists the same addresses, and the build checks they match.
  bedrockConnect: {
    url: "https://github.com/Pugmatt/BedrockConnect",
    switchXboxDns: "104.238.130.180",
    playStationDns: "45.55.68.52",
    secondaryDns: "8.8.8.8",
  },
  docs: "https://docs.ts-mc.net/",
  forum: "https://ts-mc.net/",
  map: "https://bluemap.ts-mc.net/",
} as const;
