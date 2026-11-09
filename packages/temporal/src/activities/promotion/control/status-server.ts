import { timingSafeEqual } from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod/v4";
import type { PromotionHistoryEntry } from "@shepherdjerred/ops-model/promotion/model.ts";
import { reportReceiptStore } from "#activities/reports/report-object-store.ts";
import {
  promotionStore,
  promotionStoragePrefix,
} from "#activities/promotion/store.ts";
import { readProductionPromotionStatus } from "./status.ts";

const Query = z.object({
  targetId: z.string().optional(),
  batchId: z.string().optional(),
  since: z.iso.datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export function startPromotionStatusServer(token: string) {
  const store = promotionStore();
  let cached:
    Awaited<ReturnType<typeof readProductionPromotionStatus>> | undefined;
  let readAt = 0;
  let pending:
    | Promise<Awaited<ReturnType<typeof readProductionPromotionStatus>>>
    | undefined;
  const read = async () => {
    if (cached !== undefined && Date.now() - readAt < 5000) return cached;
    pending ??= readProductionPromotionStatus(store);
    try {
      cached = await pending;
      readAt = Date.now();
      return cached;
    } finally {
      pending = undefined;
    }
  };
  return Bun.serve({
    hostname: "0.0.0.0",
    port: 7343,
    fetch: promotionStatusFetch(token, read),
  });
}

export function promotionStatusFetch(
  token: string,
  read: () => Promise<
    Awaited<ReturnType<typeof readProductionPromotionStatus>>
  >,
) {
  return async (request: Request): Promise<Response> => {
    const authorization = request.headers.get("authorization") ?? "";
    const expected = Buffer.from(`Bearer ${token}`),
      actual = Buffer.from(authorization);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      return new Response("Unauthorized", { status: 401 });
    if (request.method !== "GET")
      return new Response("Read only", { status: 405 });
    const url = new URL(request.url),
      query = Query.safeParse(Object.fromEntries(url.searchParams));
    if (!query.success)
      return Response.json({ error: "Invalid query" }, { status: 400 });
    try {
      const data = await read();
      if (url.pathname === "/api/v1/promotion")
        return Response.json(data.overview);
      if (url.pathname === "/api/v1/promotion/history")
        return historyPage(data.history, query.data);
      const id = /^\/api\/v1\/promotion\/evidence\/([a-f0-9]{64})$/.exec(
        url.pathname,
      )?.[1];
      const key = id === undefined ? undefined : data.evidence.get(id);
      if (key?.startsWith(`${promotionStoragePrefix()}/evidence/`) !== true)
        return new Response("Not found", { status: 404 });
      const storage = reportReceiptStore();
      const result = await storage.client.send(
        new GetObjectCommand({ Bucket: storage.bucket, Key: key }),
      );
      if (result.Body === undefined) throw new Error("Evidence has no body");
      return new Response(await result.Body.transformToByteArray(), {
        headers: {
          "Content-Type": key.endsWith(".png")
            ? "image/png"
            : "application/json",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    } catch {
      return Response.json(
        { error: "Promotion status is unavailable" },
        { status: 503 },
      );
    }
  };
}

function historyPage(
  history: PromotionHistoryEntry[],
  query: z.infer<typeof Query>,
) {
  const q = query;
  const rows = history.filter(
    (row) =>
      (q.targetId === undefined || row.targetId === q.targetId) &&
      (q.batchId === undefined || row.batchId === q.batchId) &&
      (q.since === undefined || row.at >= q.since),
  );
  const index =
    q.cursor === undefined
      ? 0
      : rows.findIndex((row) => row.id === q.cursor) + 1;
  if (index === 0 && q.cursor !== undefined)
    return Response.json({ error: "Invalid cursor" }, { status: 400 });
  const items = rows.slice(index, index + q.limit);
  return Response.json({
    items,
    nextCursor:
      index + items.length < rows.length ? (items.at(-1)?.id ?? null) : null,
  });
}
