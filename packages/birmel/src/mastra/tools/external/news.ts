import { createTool } from "@mastra/core/tools";
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

export const getNewsTool = createTool({
  id: "get-news",
  description: "Get news headlines on a topic",
  inputSchema: z.object({
    query: z.string().optional().describe("Search query for news"),
    category: z
      .enum([
        "business",
        "entertainment",
        "general",
        "health",
        "science",
        "sports",
        "technology",
      ])
      .optional()
      .describe("News category"),
    count: z.number().min(1).max(10).optional().describe("Number of articles (default: 5)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .array(
        z.object({
          title: z.string(),
          description: z.string().nullable(),
          url: z.string(),
          source: z.string(),
          publishedAt: z.string(),
        }),
      )
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const config = getConfig();
      const apiKey = config.externalApis.newsApiKey;

      if (!apiKey) {
        return {
          success: false,
          message: "News API key not configured",
        };
      }

      const params = new URLSearchParams({
        apiKey,
        pageSize: String(ctx.count ?? 5),
        language: "en",
      });

      let endpoint: string;
      if (ctx.query) {
        params.set("q", ctx.query);
        endpoint = "everything";
      } else {
        params.set("country", "us");
        if (ctx.category) {
          params.set("category", ctx.category);
        }
        endpoint = "top-headlines";
      }

      const response = await fetch(
        `https://newsapi.org/v2/${endpoint}?${params.toString()}`,
      );

      if (!response.ok) {
        return {
          success: false,
          message: `News API error: ${String(response.status)}`,
        };
      }

      const data = (await response.json()) as NewsApiResponse;

      if (data.status !== "ok") {
        return {
          success: false,
          message: "Failed to fetch news",
        };
      }

      const articles = data.articles.map((article) => ({
        title: article.title,
        description: article.description,
        url: article.url,
        source: article.source.name,
        publishedAt: article.publishedAt,
      }));

      return {
        success: true,
        message: `Found ${String(articles.length)} articles`,
        data: articles,
      };
    } catch (error) {
      logger.error("Failed to fetch news", error as Error);
      return {
        success: false,
        message: "Failed to fetch news",
      };
    }
  },
});

export const newsTools = [getNewsTool];
