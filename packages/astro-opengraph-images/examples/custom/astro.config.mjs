import fs from "node:fs";
import { defineConfig } from "astro/config";
import opengraphImages from "astro-opengraph-images";
import { customOgMediaLayout } from "./src/customRenderer";

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
      render: customOgMediaLayout,
    }),
  ],
});
