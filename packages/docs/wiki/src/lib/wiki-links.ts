import { fileURLToPath } from "node:url";
import { defineMdastPlugin } from "satteri";

import { rewriteWikiLink } from "./wiki-paths.ts";

const PLAIN_TEXT_LANGUAGES = new Set(["caddy", "caddyfile", "promql"]);

export function wikiLinksPlugin(docsRoot: string) {
  return defineMdastPlugin({
    name: "wiki-links",
    code(node, context) {
      if (
        typeof node.lang === "string" &&
        PLAIN_TEXT_LANGUAGES.has(node.lang)
      ) {
        context.setProperty(node, "lang", "text");
      }
    },
    link(node, context) {
      if (!context.fileURL) {
        return;
      }

      const sourceFile = fileURLToPath(context.fileURL).replaceAll("\\", "/");
      const normalizedRoot = docsRoot
        .replaceAll("\\", "/")
        .replaceAll(/\/$/gu, "");
      const sourcePath = sourceFile.startsWith(`${normalizedRoot}/`)
        ? `packages/docs/${sourceFile.slice(normalizedRoot.length + 1)}`
        : sourceFile;
      context.setProperty(node, "url", rewriteWikiLink(sourcePath, node.url));
    },
  });
}
