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

export const webTools = [fetchUrlTool];
