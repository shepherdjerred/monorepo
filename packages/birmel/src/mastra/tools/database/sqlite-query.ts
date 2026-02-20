import {
  getErrorMessage,
  toError,
} from "@shepherdjerred/birmel/utils/errors.ts";
import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { captureException } from "@shepherdjerred/birmel/observability/sentry.ts";
import { withToolSpan } from "@shepherdjerred/birmel/observability/tracing.ts";

const logger = loggers.tools.child("database.sqlite");

export const manageDatabaseTool = createTool({
  id: "manage-database",
  description:
    "Manage database: execute SELECT queries or get schema information",
  inputSchema: z.object({
    action: z.enum(["query", "schema"]).describe("The action to perform"),
    query: z
      .string()
      .optional()
      .describe("SQL SELECT query (for query action)"),
    params: z
      .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional()
      .describe("Query parameters (for query action)"),
    limit: z
      .number()
      .min(1)
      .max(1000)
      .optional()
      .describe("Max rows to return (for query, default: 100)"),
    tableName: z
      .string()
      .optional()
      .describe("Specific table name (for schema action)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  execute: async (input) => {
    return withToolSpan("manage-database", undefined, async () => {
      try {
        switch (input.action) {
          case "query": {
            if (input.query == null || input.query.length === 0) {
              return {
                success: false,
                message: "query is required for query action",
              };
            }
            const trimmedQuery = input.query.trim().toUpperCase();
            if (!trimmedQuery.startsWith("SELECT")) {
              return {
                success: false,
                message: "Only SELECT queries are allowed for safety",
              };
            }
            let finalQuery = input.query;
            if (!trimmedQuery.includes("LIMIT")) {
              finalQuery += ` LIMIT ${String(input.limit ?? 100)}`;
            }
            const rows = await prisma.$queryRawUnsafe<
              Record<string, unknown>[]
            >(finalQuery, ...(input.params ?? []));
            logger.info("SQLite query executed", { rowCount: rows.length });
            return {
              success: true,
              message: `Returned ${rows.length.toString()} rows`,
              data: { rows, count: rows.length },
            };
          }

          case "schema": {
            let query = `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'`;
            const params: string[] = [];
            if (input.tableName != null && input.tableName.length > 0) {
              query += " AND name = ?";
              params.push(input.tableName);
            }
            query += " ORDER BY name";
            const tables = await prisma.$queryRawUnsafe<
              { name: string; sql: string }[]
            >(query, ...params);
            logger.info("Database schema fetched", {
              tableCount: tables.length,
            });
            return {
              success: true,
              message: `Found ${tables.length.toString()} table(s)`,
              data: { tables },
            };
          }
        }
      } catch (error) {
        logger.error("Database operation failed", error);
        captureException(toError(error), { operation: "tool.manage-database" });
        return {
          success: false,
          message: `Failed: ${getErrorMessage(error)}`,
        };
      }
    });
  },
});

export const sqliteTools = [manageDatabaseTool];
