import { defineGameViteConfig } from "@shepherdjerred/discord-plays-web/vite/game-vite-config.ts";
import Unfonts from "unplugin-fonts/vite";

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
        ],
      },
    }),
  ],
});
