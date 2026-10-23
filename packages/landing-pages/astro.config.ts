import { readFileSync } from "node:fs";
import { defineConfig } from "astro/config";
import { server } from "./src/items/the-storm/server.ts";

// The Storm page repeats facts that live in other packages without a shared
// data file. Fail the build when a source moves on without the page.
function requireInSource(path: string, needle: string, what: string) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  if (!source.includes(needle))
    throw new Error(`${what} (${needle}) no longer matches ${path}`);
}
requireInSource(
  "../the-storm/server/Dockerfile",
  `VERSION=${server.java.version} `,
  "The Storm Java version",
);
requireInSource(
  "../ts-mc-docs/astro.config.ts",
  `href: "${server.discord}"`,
  "The Storm Discord invite",
);

for (const dns of [
  server.bedrockConnect.switchXboxDns,
  server.bedrockConnect.playStationDns,
]) {
  requireInSource(
    "../ts-mc-docs/src/content/docs/join.md",
    dns,
    "BedrockConnect DNS",
  );
}

export default defineConfig({
  devToolbar: { enabled: false },
  output: "static",
  site: "https://pages.sjer.red",
  trailingSlash: "always",
  build: { format: "directory" },
});
