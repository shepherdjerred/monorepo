import { defineConfig, mergeConfig } from "vite";
import { z } from "zod";
import base from "./vite.config.ts";

const api = z
  .url()
  .parse(Bun.env["PROMOTION_LOCAL_API_URL"] ?? "http://127.0.0.1:7343");
export default mergeConfig(
  { ...base, server: { ...base.server, proxy: {} } },
  defineConfig({
    plugins: [
      {
        name: "local-promotion-entry",
        transformIndexHtml: {
          order: "pre",
          handler(html) {
            return html.replace(
              "/src/client/main.tsx",
              "/src/client/promotion/main.tsx",
            );
          },
        },
      },
    ],
    server: {
      proxy: { "/api/v1/promotion": { target: api, changeOrigin: true } },
    },
  }),
);
