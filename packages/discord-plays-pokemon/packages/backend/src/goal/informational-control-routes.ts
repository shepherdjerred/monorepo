import { z } from "zod";
import type { GoalControlContext, Routed } from "./control-context.ts";
import { formatHistoryForPrompt } from "./history-summary.ts";
import { KnowledgeDomainSchema, loadKnowledgeBase } from "./knowledge.ts";
import { truncateForToolLog } from "./goal-tool-log.ts";

const HistoryQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(10).optional(),
});

const KnowledgeSearchQuerySchema = z.strictObject({
  q: z.string().min(2).max(200),
  domain: KnowledgeDomainSchema.optional(),
  limit: z.coerce.number().int().min(1).max(10).optional(),
});

const KnowledgeGetQuerySchema = z.strictObject({
  id: z.string().min(1).max(300),
});

function queryParams(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function historyResponse(
  context: GoalControlContext,
  request: Request,
): Routed {
  const params = queryParams(request);
  const parsed = HistoryQuerySchema.safeParse(params);
  if (!parsed.success) {
    return {
      response: jsonResponse(
        { error: "limit must be an integer between 1 and 10" },
        400,
      ),
      logBody: "invalid limit",
      requestMeta: params,
    };
  }
  const limit = parsed.data.limit ?? 3;
  const body = formatHistoryForPrompt(context.goalManager.getHistory(limit));
  return {
    response: new Response(body, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
    logBody: truncateForToolLog(body),
    requestMeta: { limit },
  };
}

async function knowledgeSearchResponse(request: Request): Promise<Routed> {
  const params = queryParams(request);
  const parsed = KnowledgeSearchQuerySchema.safeParse(params);
  if (!parsed.success) {
    const response = jsonResponse(
      {
        error:
          "knowledge search requires q (2-200 chars), optional domain, and limit 1-10",
      },
      400,
    );
    return { response, requestMeta: params, logBody: { status: 400 } };
  }
  const base = await loadKnowledgeBase();
  const response = jsonResponse({
    query: parsed.data.q,
    results: base.search(parsed.data.q, {
      ...(parsed.data.domain === undefined
        ? {}
        : { domain: parsed.data.domain }),
      limit: parsed.data.limit ?? 5,
    }),
  });
  return { response, requestMeta: params, logBody: { status: 200 } };
}

async function knowledgeGetResponse(request: Request): Promise<Routed> {
  const params = queryParams(request);
  const parsed = KnowledgeGetQuerySchema.safeParse(params);
  if (!parsed.success) {
    const response = jsonResponse(
      { error: "knowledge get requires an id" },
      400,
    );
    return { response, requestMeta: params, logBody: { status: 400 } };
  }
  const base = await loadKnowledgeBase();
  const record = base.get(parsed.data.id);
  const response =
    record === undefined
      ? jsonResponse({ error: "knowledge record not found" }, 404)
      : jsonResponse(record);
  return {
    response,
    requestMeta: params,
    logBody: { status: response.status },
  };
}

export async function routeInformationalRequest(
  context: GoalControlContext,
  request: Request,
): Promise<Routed | undefined> {
  const url = new URL(request.url);
  switch (`${request.method} ${url.pathname}`) {
    case "GET /history":
      return historyResponse(context, request);
    case "GET /knowledge/search":
      return await knowledgeSearchResponse(request);
    case "GET /knowledge/get":
      return await knowledgeGetResponse(request);
    default:
      return undefined;
  }
}
