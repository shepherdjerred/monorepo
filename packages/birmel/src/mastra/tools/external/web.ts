import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { logger } from "../../../utils/index.js";

export const fetchUrlTool = createTool({
  id: "fetch-url",
  description: "Fetch and summarize content from a URL",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to fetch"),
    maxLength: z
      .number()
      .optional()
      .describe("Maximum length of content to return (default: 2000)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        title: z.string().optional(),
        content: z.string(),
        url: z.string(),
      })
      .optional(),
  }),
  execute: async (input) => {
    try {
      const response = await fetch(input.url, {
        headers: {
          "User-Agent": "Birmel Discord Bot/1.0",
        },
      });

      if (!response.ok) {
        return {
          success: false,
          message: `Failed to fetch URL: ${String(response.status)} ${response.statusText}`,
        };
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
        return {
          success: false,
          message: "URL does not return text content",
        };
      }

      const html = await response.text();

      // Simple HTML to text extraction
      const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
      const title = titleMatch?.[1]?.trim();

      // Remove script and style tags, then strip HTML
      let content = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const maxLength = input.maxLength ?? 2000;
      if (content.length > maxLength) {
        content = content.substring(0, maxLength) + "...";
      }

      return {
        success: true,
        message: "Successfully fetched URL",
        data: {
          ...(title !== undefined && { title }),
          content,
          url: input.url,
        },
      };
    } catch (error) {
      logger.error("Failed to fetch URL", error as Error);
      return {
        success: false,
        message: "Failed to fetch URL",
      };
    }
  },
});

export const webSearchTool = createTool({
  id: "web-search",
  description: "Search the web for information. Use this to look up current prices, documentation, news, or any other web-accessible information.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        results: z.array(
          z.object({
            title: z.string(),
            url: z.string(),
            snippet: z.string(),
          })
        ),
      })
      .optional(),
  }),
  execute: async (input) => {
    try {
      // Use DuckDuckGo HTML for simple search results
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`;
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Birmel Discord Bot/1.0",
        },
      });

      if (!response.ok) {
        return {
          success: false,
          message: `Search failed: ${String(response.status)}`,
        };
      }

      const html = await response.text();

      // Parse search results from DuckDuckGo HTML
      const results: { title: string; url: string; snippet: string }[] = [];
      const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/a>/g;

      let match;
      while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
        const [, url, title, snippetHtml] = match;
        if (url && title && snippetHtml) {
          const snippet = snippetHtml.replace(/<[^>]+>/g, "").trim();
          results.push({
            title: title.trim(),
            url: decodeURIComponent(url.replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "").split("&")[0] ?? ""),
            snippet,
          });
        }
      }

      // Fallback: simpler parsing if regex didn't match
      if (results.length === 0) {
        const simpleRegex = /<a[^>]+class="result__a"[^>]+>([^<]+)<\/a>/g;
        let fallbackCount = 0;
        while ((match = simpleRegex.exec(html)) !== null && fallbackCount < 5) {
          const title = match[1];
          if (title) {
            results.push({
              title: title.trim(),
              url: "",
              snippet: "No snippet available",
            });
            fallbackCount++;
          }
        }
      }

      return {
        success: true,
        message: `Found ${String(results.length)} results`,
        data: { results },
      };
    } catch (error) {
      logger.error("Web search failed", error as Error);
      return {
        success: false,
        message: "Web search failed",
      };
    }
  },
});

export const webTools = [fetchUrlTool, webSearchTool];
