import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import remarkToc from "remark-toc";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { rehypeHeadingIds, unified } from "@astrojs/markdown-remark";
import icon from "astro-icon";
import astroOpenGraphImages, { presets } from "astro-opengraph-images";
import { rendererRich, transformerTwoslash } from "@shikijs/twoslash";
import rehypeMermaid from "rehype-mermaid";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fontPath = fileURLToPath(
  new URL(
    "public/fonts/CommitMono/CommitMono-700-Regular.otf",
    import.meta.url,
  ),
);
const fontData = readFileSync(fontPath).buffer;

// Bugsink release: Turbo's content hash of this build task. CI builds the
// deployed dist through `turbo run build`, so a remote-cache hit and a fresh
// build of the same inputs carry the same identity, and unchanged inputs still
// rebuild to identical bytes that Delivery retains. No commit or build number
// is baked in. Builds outside Turbo (local dev) report no release.
const turboHash = process.env["TURBO_HASH"];
const bugsinkReleaseDefine =
  turboHash === undefined || turboHash === ""
    ? {}
    : {
        "import.meta.env.PUBLIC_BUGSINK_RELEASE": JSON.stringify(
          `sjer-red@turbo:${turboHash}`,
        ),
      };

// https://astro.build/config
export default defineConfig({
  compressHTML: true,
  markdown: {
    processor: unified({
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
    }),
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
    define: bugsinkReleaseDefine,
    plugins: [tailwindcss()],
    resolve: {
      noExternal: ["entities", "rss-parser"],
      tsconfigPaths: true,
    },
    ssr: {
      external: ["@resvg/resvg-js"],
    },
  },
});
