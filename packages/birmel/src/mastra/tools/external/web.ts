import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { getConfig } from "../../../config/index.js";
import { logger } from "../../../utils/index.js";

type NewsArticle = {
  title: string;
  description: string | null;
  url: string;
  source: { name: string };
  publishedAt: string;
};

type NewsApiResponse = {
  status: string;
  articles: NewsArticle[];
};

export const externalServiceTool = createTool({
  id: "external-service",
  description: "Access external services: fetch URL content, web search, get news headlines, or get LoL updates",
  inputSchema: z.object({
    action: z.enum(["fetch-url", "search", "news", "lol"]).describe("The action to perform"),
    url: z.string().optional().describe("URL to fetch (for fetch-url)"),
    maxLength: z.number().optional().describe("Max content length (for fetch-url, default: 2000)"),
    query: z.string().optional().describe("Search query (for search/news)"),
    newsCategory: z.enum(["business", "entertainment", "general", "health", "science", "sports", "technology"]).optional().describe("News category (for news)"),
    newsCount: z.number().min(1).max(10).optional().describe("Number of articles (for news, default: 5)"),
    lolType: z.enum(["patch", "status", "champions"]).optional().describe("LoL update type (for lol, default: patch)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  execute: async (ctx) => {
    const config = getConfig();

    try {
      switch (ctx.action) {
        case "fetch-url": {
          if (!ctx.url) {return { success: false, message: "url is required for fetch-url" };}
          const response = await fetch(ctx.url, { headers: { "User-Agent": "Birmel Discord Bot/1.0" } });
          if (!response.ok) {return { success: false, message: `Failed to fetch URL: ${String(response.status)}` };}
          const contentType = response.headers.get("content-type") ?? "";
          if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
            return { success: false, message: "URL does not return text content" };
          }
          const html = await response.text();
          const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
          const title = titleMatch?.[1]?.trim();
          let content = html
            .replaceAll(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replaceAll(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
            .replaceAll(/<[^>]+>/g, " ")
            .replaceAll(/\s+/g, " ")
            .trim();
          const maxLength = ctx.maxLength ?? 2000;
          if (content.length > maxLength) {content = content.slice(0, Math.max(0, maxLength)) + "...";}
          return { success: true, message: "Successfully fetched URL", data: { ...(title && { title }), content, url: ctx.url } };
        }

        case "search": {
          if (!ctx.query) {return { success: false, message: "query is required for search" };}
          const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(ctx.query)}`;
          const response = await fetch(searchUrl, { headers: { "User-Agent": "Birmel Discord Bot/1.0" } });
          if (!response.ok) {return { success: false, message: `Search failed: ${String(response.status)}` };}
          const html = await response.text();
          const results: { title: string; url: string; snippet: string }[] = [];
          const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/a>/g;
          let match;
          while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
            const [, url, title, snippetHtml] = match;
            if (url && title && snippetHtml) {
              results.push({
                title: title.trim(),
                url: decodeURIComponent(url.replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "").split("&")[0] ?? ""),
                snippet: snippetHtml.replaceAll(/<[^>]+>/g, "").trim(),
              });
            }
          }
          return { success: true, message: `Found ${String(results.length)} results`, data: { results } };
        }

        case "news": {
          const apiKey = config.externalApis.newsApiKey;
          if (!apiKey) {return { success: false, message: "News API key not configured" };}
          const params = new URLSearchParams({ apiKey, pageSize: String(ctx.newsCount ?? 5), language: "en" });
          let endpoint: string;
          if (ctx.query) {
            params.set("q", ctx.query);
            endpoint = "everything";
          } else {
            params.set("country", "us");
            if (ctx.newsCategory) {params.set("category", ctx.newsCategory);}
            endpoint = "top-headlines";
          }
          const response = await fetch(`https://newsapi.org/v2/${endpoint}?${params.toString()}`);
          if (!response.ok) {return { success: false, message: `News API error: ${String(response.status)}` };}
          const data = (await response.json()) as NewsApiResponse;
          if (data.status !== "ok") {return { success: false, message: "Failed to fetch news" };}
          const articles = data.articles.map((a) => ({
            title: a.title,
            description: a.description,
            url: a.url,
            source: a.source.name,
            publishedAt: a.publishedAt,
          }));
          return { success: true, message: `Found ${String(articles.length)} articles`, data: articles };
        }

        case "lol": {
          const lolType = ctx.lolType ?? "patch";
          if (lolType === "patch" || lolType === "champions") {
            const response = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
            if (!response.ok) {return { success: false, message: "Failed to fetch patch info" };}
            const versions = (await response.json()) as string[];
            const latestVersion = versions[0];
            if (lolType === "patch") {
              return { success: true, message: `Current LoL patch: ${latestVersion ?? "Unknown"}`, data: { version: latestVersion, info: "https://www.leagueoflegends.com/en-us/news/tags/patch-notes/" } };
            }
            return { success: true, message: "Champion data available", data: { version: latestVersion, info: `https://ddragon.leagueoflegends.com/cdn/${latestVersion ?? "latest"}/data/en_US/champion.json` } };
          }
          // status
          const apiKey = config.externalApis.riotApiKey;
          if (!apiKey) {return { success: false, message: "Riot API key not configured" };}
          const response = await fetch("https://na1.api.riotgames.com/lol/status/v4/platform-data", { headers: { "X-Riot-Token": apiKey } });
          if (!response.ok) {return { success: false, message: `Riot API error: ${String(response.status)}` };}
          const data = (await response.json()) as { incidents: unknown[]; maintenances: unknown[] };
          const incidents = data.incidents.length;
          const maintenances = data.maintenances.length;
          return {
            success: true,
            message: `LoL Status: ${String(incidents)} incidents, ${String(maintenances)} maintenances`,
            data: { status: incidents === 0 && maintenances === 0 ? "All systems operational" : `${String(incidents)} incidents, ${String(maintenances)} maintenances` },
          };
        }
      }
    } catch (error) {
      logger.error("External service failed", error as Error);
      return { success: false, message: `Failed: ${(error as Error).message}` };
    }
  },
});

export const webTools = [externalServiceTool];
