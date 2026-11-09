import type { PromotionHistoryEntry } from "@shepherdjerred/ops-model/promotion/model.ts";
import { z } from "zod";
import { readDashboard, receiptFile } from "./dashboard-data.ts";

const Query = z.object({
  targetId: z.string().optional(),
  batchId: z.string().optional(),
  mode: z
    .enum(["preview", "run", "reconcile", "cleanup", "unknown"])
    .optional(),
  since: z.iso.datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export function dashboardFetch(directory: string) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      return new Response("Invalid host", { status: 403 });
    if (request.method !== "GET")
      return new Response("Read only", { status: 405 });
    const query = Query.safeParse(Object.fromEntries(url.searchParams));
    if (!query.success)
      return Response.json(
        { error: "Invalid query", code: "invalid_query" },
        { status: 400 },
      );
    try {
      const data = await readDashboard(directory);
      if (url.pathname === "/api/v1/promotion")
        return Response.json(data.overview);
      if (url.pathname === "/api/v1/promotion/history") {
        return historyPage(data.history, query.data);
      }
      const id = /^\/api\/v1\/promotion\/evidence\/([a-f0-9]{64})$/.exec(
        url.pathname,
      )?.[1];
      const file = id === undefined ? undefined : data.evidence.get(id);
      return file === undefined
        ? Response.json({ error: "Not found" }, { status: 404 })
        : new Response(Bun.file(await receiptFile(directory, file)), {
            headers: {
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'; sandbox",
            },
          });
    } catch (error) {
      return error instanceof z.ZodError
        ? Response.json(
            {
              error: "Invalid saved promotion data",
              code: "invalid_data",
            },
            { status: 500 },
          )
        : Response.json(
            {
              error: "Local promotion storage or evidence unavailable",
              code: "storage_unavailable",
            },
            { status: 503 },
          );
    }
  };
}

function historyPage(
  history: PromotionHistoryEntry[],
  query: z.infer<typeof Query>,
) {
  const rows = history.filter(
    (item) =>
      (query.targetId === undefined || item.targetId === query.targetId) &&
      (query.batchId === undefined || item.batchId === query.batchId) &&
      (query.mode === undefined || item.mode === query.mode) &&
      (query.since === undefined || item.at >= query.since),
  );
  const index =
    query.cursor === undefined
      ? 0
      : rows.findIndex((item) => item.id === query.cursor) + 1;
  if (index === 0 && query.cursor !== undefined)
    return Response.json({ error: "Unknown history cursor" }, { status: 400 });
  const items = rows.slice(index, index + query.limit);
  return Response.json({
    items,
    nextCursor:
      index + items.length < rows.length ? (items.at(-1)?.id ?? null) : null,
  });
}
