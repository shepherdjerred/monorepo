import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getConfig } from "../../../config/index.js";
import { logger } from "../../../utils/index.js";

export const getLolUpdatesTool = createTool({
  id: "get-lol-updates",
  description: "Get League of Legends patch notes and updates",
  inputSchema: z.object({
    type: z
      .enum(["patch", "status", "champions"])
      .optional()
      .describe("Type of update to fetch (default: patch)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        version: z.string().optional(),
        status: z.string().optional(),
        info: z.string().optional(),
      })
      .optional(),
  }),
  execute: async (input) => {
    try {
      const config = getConfig();
      const type = input.type ?? "patch";

      if (type === "patch") {
        // Get latest patch version from Data Dragon
        const response = await fetch(
          "https://ddragon.leagueoflegends.com/api/versions.json",
        );

        if (!response.ok) {
          return {
            success: false,
            message: "Failed to fetch patch info",
          };
        }

        const versions = (await response.json()) as string[];
        const latestVersion = versions[0];

        return {
          success: true,
          message: `Current LoL patch: ${latestVersion ?? "Unknown"}`,
          data: {
            version: latestVersion,
            info: `View patch notes at: https://www.leagueoflegends.com/en-us/news/tags/patch-notes/`,
          },
        };
      }

      if (type === "status") {
        // Check Riot API status
        const apiKey = config.externalApis.riotApiKey;
        if (!apiKey) {
          return {
            success: false,
            message: "Riot API key not configured",
          };
        }

        const response = await fetch(
          "https://na1.api.riotgames.com/lol/status/v4/platform-data",
          {
            headers: {
              "X-Riot-Token": apiKey,
            },
          },
        );

        if (!response.ok) {
          return {
            success: false,
            message: `Riot API error: ${String(response.status)}`,
          };
        }

        const data = (await response.json()) as {
          name: string;
          incidents: { titles: { content: string }[] }[];
          maintenances: { titles: { content: string }[] }[];
        };

        const incidents = data.incidents.length;
        const maintenances = data.maintenances.length;

        return {
          success: true,
          message: `LoL Status: ${String(incidents)} incidents, ${String(maintenances)} maintenances`,
          data: {
            status:
              incidents === 0 && maintenances === 0
                ? "All systems operational"
                : `${String(incidents)} incidents, ${String(maintenances)} maintenances`,
          },
        };
      }

      // type === "champions"
      // Get champion list
      const versionsResponse = await fetch(
        "https://ddragon.leagueoflegends.com/api/versions.json",
      );

      if (!versionsResponse.ok) {
        return {
          success: false,
          message: "Failed to fetch version info",
        };
      }

      const champVersions = (await versionsResponse.json()) as string[];
      const champLatestVersion = champVersions[0];

      return {
        success: true,
        message: "Champion data available",
        data: {
          version: champLatestVersion,
          info: `Champion data at: https://ddragon.leagueoflegends.com/cdn/${champLatestVersion ?? "latest"}/data/en_US/champion.json`,
        },
      };
    } catch (error) {
      logger.error("Failed to fetch LoL updates", error as Error);
      return {
        success: false,
        message: "Failed to fetch LoL updates",
      };
    }
  },
});

export const lolTools = [getLolUpdatesTool];
