import fs from "node:fs";
import { defineConfig } from "astro/config";
import opengraphImages, { presets } from "astro-opengraph-images";

// https://astro.build/config
export default defineConfig({
  site: "http://example.com",
  integrations: [
    opengraphImages({
      options: {
        fonts: [
          {
            name: "Roboto",
            weight: 400,
            style: "normal",
            data: fs.readFileSync("node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff"),
          },
        ],
      },
      render: presets.blackAndWhite,
    }),
  ],
});
