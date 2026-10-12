import Unfonts from "unplugin-fonts/vite";
import { defineGameViteConfig } from "@shepherdjerred/discord-plays-web/vite/game-vite-config.ts";

export default defineGameViteConfig({
  backendPort: 8081,
  plugins: [
    Unfonts({
      google: {
        preconnect: true,
        families: [
          {
            name: "Inter",
          },
          // Chunky display face for headings, placements and seat labels,
          // in the spirit of MK64's title and results lettering.
          {
            name: "Lilita One",
          },
        ],
      },
    }),
  ],
});
