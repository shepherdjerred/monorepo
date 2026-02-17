import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import remarkToc from "remark-toc";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { rehypeHeadingIds } from "@astrojs/markdown-remark";
import icon from "astro-icon";
import astroOpenGraphImages, { presets } from "astro-opengraph-images";
import { rendererRich, transformerTwoslash } from "@shikijs/twoslash";
import rehypeMermaid from "rehype-mermaid";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fontPath = fileURLToPath(new URL("public/fonts/CommitMono/CommitMono-700-Regular.otf", import.meta.url));
const fontData = readFileSync(fontPath).buffer;

// https://astro.build/config
export default defineConfig({
  markdown: {
    syntaxHighlight: {
      type: "shiki",
      excludeLangs: ["mermaid"],
    },
    shikiConfig: {
      theme: "github-dark",
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      wrap: true,
      transformers: [
        transformerTwoslash({
          renderer: rendererRich({}),
        }),
      ],
    },
    rehypePlugins: [
      [
        rehypeMermaid,
        {
          strategy: "img-svg",
          dark: true,
        },
      ],
      rehypeHeadingIds,
      [
        rehypeAutolinkHeadings,
        {
          behavior: "append",
        },
      ],
    ],
    remarkPlugins: [remarkToc],
  },

  site: "https://sjer.red",

  integrations: [
    mdx(),
    sitemap(),
    icon(),
    astroOpenGraphImages({
      options: {
        fonts: [
          {
            data: fontData,
            name: "Commit Mono",
            weight: 400,
            style: "normal",
          },
        ],
      },
      render: presets.blackAndWhite,
    }),
  ],

  security: {
    checkOrigin: true,
  },

  prefetch: true,

  vite: {
    // @ts-expect-error tailwindcss uses vite 7.x types but Astro uses vite 6.x
    plugins: [tailwindcss()],
    ssr: {
      external: ["@resvg/resvg-js"],
    },
  },
});
