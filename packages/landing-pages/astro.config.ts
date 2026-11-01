import { readFileSync } from "node:fs";
import { defineConfig, fontProviders } from "astro/config";
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
  `VERSION=${server.java.serverVersion} `,
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
  site: "https://public.ts-mc.net",
  trailingSlash: "always",
  // Pages are small; inline styles save the only render-blocking request.
  build: { format: "directory", inlineStylesheets: "always" },
  // Fonts come from the installed Fontsource files, so the build stays
  // offline. Astro preloads them and emits metric-matched fallbacks, so the
  // swap from the fallback face does not shift the layout.
  fonts: [
    {
      provider: fontProviders.local(),
      name: "Outfit",
      cssVariable: "--font-outfit",
      fallbacks: ["sans-serif"],
      options: {
        variants: [
          {
            src: [
              "@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2",
            ],
            weight: "100 900",
            style: "normal",
          },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: "Lora",
      cssVariable: "--font-lora",
      fallbacks: ["serif"],
      options: {
        variants: [
          {
            src: [
              "@fontsource-variable/lora/files/lora-latin-wght-italic.woff2",
            ],
            weight: "400 700",
            style: "italic",
          },
        ],
      },
    },
  ],
});
