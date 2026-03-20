import {
  getErrorMessage,
  toError,
} from "@shepherdjerred/birmel/utils/errors.ts";
import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import {
  handleFetchUrl,
  handleSearch,
  handleNews,
  handleLol,
} from "./web-actions.ts";

export const externalServiceTool = createTool({
  id: "external-service",
  description:
    "Access external services: fetch URL content, web search, get news headlines, or get LoL updates",
  inputSchema: z.object({
    action: z
      .enum(["fetch-url", "search", "news", "lol"])
      .describe("The action to perform"),
    url: z.string().optional().describe("URL to fetch (for fetch-url)"),
    maxLength: z
      .number()
      .optional()
      .describe("Max content length (for fetch-url, default: 2000)"),
    query: z.string().optional().describe("Search query (for search/news)"),
    newsCategory: z
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
      .describe("News category (for news)"),
    newsCount: z
      .number()
      .min(1)
      .max(10)
      .optional()
      .describe("Number of articles (for news, default: 5)"),
    lolType: z
      .enum(["patch", "status", "champions"])
      .optional()
      .describe("LoL update type (for lol, default: patch)"),
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
        case "fetch-url":
          return await handleFetchUrl(ctx.url, ctx.maxLength);
        case "search":
          return await handleSearch(ctx.query);
        case "news":
          return await handleNews(
            config.externalApis.newsApiKey,
            ctx.query,
            ctx.newsCategory,
            ctx.newsCount,
          );
        case "lol":
          return await handleLol(ctx.lolType, config.externalApis.riotApiKey);
      }
    } catch (error) {
      logger.error("External service failed", toError(error));
      return { success: false, message: `Failed: ${getErrorMessage(error)}` };
    }
  },
});

export const webTools = [externalServiceTool];
