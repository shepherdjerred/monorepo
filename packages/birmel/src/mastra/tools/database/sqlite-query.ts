import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { prisma } from "../../../database/index.js";
import { loggers } from "../../../utils/logger.js";
import { captureException, withToolSpan } from "../../../observability/index.js";

const logger = loggers.tools.child("database.sqlite");

export const querySqliteTool = createTool({
	id: "query-sqlite",
	description:
		"Execute a SELECT query on the Birmel SQLite database. Only SELECT statements are allowed for safety. Returns query results as JSON.",
	inputSchema: z.object({
		query: z
			.string()
			.describe(
				"SQL SELECT query to execute. Must start with SELECT. Example: SELECT * FROM ElectionPoll WHERE guildId = ?",
			),
		params: z
			.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
			.optional()
			.describe(
				"Optional parameters for parameterized queries. Use ? placeholders in the query.",
			),
		limit: z
			.number()
			.min(1)
			.max(1000)
			.optional()
			.default(100)
			.describe("Maximum number of rows to return (default: 100, max: 1000)"),
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		data: z
			.object({
				rows: z.array(z.record(z.string(), z.any())),
				count: z.number(),
			})
			.optional(),
	}),
	execute: async (input) => {
		return withToolSpan("query-sqlite", undefined, async () => {
			logger.debug("Executing SQLite query", {
				query: input.query,
				paramsCount: input.params?.length ?? 0,
			});

			try {
				// Security: Only allow SELECT statements
				const trimmedQuery = input.query.trim().toUpperCase();
				if (!trimmedQuery.startsWith("SELECT")) {
					return {
						success: false,
						message:
							"Only SELECT queries are allowed for safety. Use Prisma methods for mutations.",
					};
				}

				// Add LIMIT if not present
				let finalQuery = input.query;
				if (!trimmedQuery.includes("LIMIT")) {
					finalQuery += ` LIMIT ${String(input.limit)}`;
				}

				// Execute raw query
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const rows = await prisma.$queryRawUnsafe<any[]>(
					finalQuery,
					...(input.params ?? []),
				);

				logger.info("SQLite query executed successfully", {
					rowCount: rows.length,
				});

				return {
					success: true,
					message: `Query executed successfully, returned ${rows.length.toString()} rows`,
					data: {
						rows,
						count: rows.length,
					},
				};
			} catch (error) {
				logger.error("Failed to execute SQLite query", error, {
					query: input.query,
				});
				captureException(error as Error, {
					operation: "tool.query-sqlite",
					extra: { query: input.query },
				});
				return {
					success: false,
					message: `Query failed: ${(error as Error).message}`,
				};
			}
		});
	},
});

export const getDatabaseSchemaTool = createTool({
	id: "get-database-schema",
	description:
		"Get the schema information for all tables in the Birmel SQLite database. Returns table names and their column definitions.",
	inputSchema: z.object({
		tableName: z
			.string()
			.optional()
			.describe("Optional: Get schema for a specific table only"),
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		data: z
			.object({
				tables: z.array(
					z.object({
						name: z.string(),
						sql: z.string(),
					}),
				),
			})
			.optional(),
	}),
	execute: async (input) => {
		return withToolSpan("get-database-schema", undefined, async () => {
			logger.debug("Fetching database schema", { tableName: input.tableName });

			try {
				let query = `
          SELECT name, sql
          FROM sqlite_master
          WHERE type='table'
          AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE '_prisma%'
        `;

				const params: string[] = [];
				if (input.tableName) {
					query += " AND name = ?";
					params.push(input.tableName);
				}

				query += " ORDER BY name";

				const tables = await prisma.$queryRawUnsafe<
					{ name: string; sql: string }[]
				>(query, ...params);

				logger.info("Database schema fetched", { tableCount: tables.length });

				return {
					success: true,
					message: `Found ${tables.length.toString()} table(s)`,
					data: {
						tables,
					},
				};
			} catch (error) {
				logger.error("Failed to fetch database schema", error);
				captureException(error as Error, {
					operation: "tool.get-database-schema",
				});
				return {
					success: false,
					message: `Failed to fetch schema: ${(error as Error).message}`,
				};
			}
		});
	},
});

export const sqliteTools = [querySqliteTool, getDatabaseSchemaTool];
