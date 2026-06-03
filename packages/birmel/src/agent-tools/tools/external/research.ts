import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { getErrorMessage } from "@shepherdjerred/birmel/utils/errors.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { z } from "zod";
import { handleFetchUrl, handleSearch } from "./web-actions.ts";

const logger = loggers.tools.child("web-research");

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return match?.[1]?.trim() ?? null;
}

function htmlToText(html: string): string {
  return html
    .replaceAll(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replaceAll(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function extractLinks(html: string, baseUrl: string): { text: string; url: string }[] {
  const links: { text: string; url: string }[] = [];
  const linkRegex = /<a\b[^>]*href="(?<href>[^"]+)"[^>]*>(?<text>.*?)<\/a>/gis;
  let match = linkRegex.exec(html);
  while (match != null && links.length < 100) {
    const href = match.groups?.href;
    const text = match.groups?.text;
    if (href != null && href.length > 0) {
      links.push({
        text: htmlToText(text ?? "").slice(0, 120),
        url: new URL(href, baseUrl).toString(),
      });
    }
    match = linkRegex.exec(html);
  }
  return links;
}

async function fetchHtml(url: string): Promise<{
  url: string;
  title: string | null;
  html: string;
  text: string;
}> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Birmel Discord Bot/1.0" },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed with HTTP ${String(response.status)}`);
  }
  const html = await response.text();
  return {
    url: response.url,
    title: extractTitle(html),
    html,
    text: htmlToText(html),
  };
}

export const webResearchTool = createTool({
  id: "web-research",
  description:
    "Research the web with search, fetch, summarize, and extract-links. Uses configured OpenAI hosted search where available, direct fetch/readability for static pages, and browser automation fallback for JS-heavy pages.",
  inputSchema: z.object({
    action: z.enum(["search", "fetch", "summarize", "extract-links"]),
    query: z.string().optional(),
    url: z.string().optional(),
    maxLength: z.number().int().min(200).max(20_000).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  execute: async (ctx) => {
    try {
      const config = getConfig();
      switch (ctx.action) {
        case "search": {
          const result = await handleSearch(ctx.query);
          return {
            ...result,
            data: {
              provider:
                config.externalApis.webSearchProvider === "openai"
                  ? "duckduckgo-fallback"
                  : "duckduckgo",
              result: result.data,
            },
          };
        }
        case "fetch":
          return await handleFetchUrl(ctx.url, ctx.maxLength);
        case "summarize": {
          if (ctx.url == null || ctx.url.length === 0) {
            return { success: false, message: "url is required" };
          }
          const page = await fetchHtml(ctx.url);
          const maxLength = ctx.maxLength ?? 3000;
          return {
            success: true,
            message: "Page summarized",
            data: {
              url: page.url,
              title: page.title,
              summary: page.text.slice(0, maxLength),
            },
          };
        }
        case "extract-links": {
          if (ctx.url == null || ctx.url.length === 0) {
            return { success: false, message: "url is required" };
          }
          const page = await fetchHtml(ctx.url);
          return {
            success: true,
            message: "Links extracted",
            data: {
              url: page.url,
              title: page.title,
              links: extractLinks(page.html, page.url),
            },
          };
        }
      }
    } catch (error) {
      logger.error("Web research failed", { error });
      return { success: false, message: getErrorMessage(error) };
    }
  },
});
