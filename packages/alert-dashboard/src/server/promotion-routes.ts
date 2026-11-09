import type { Hono, Context } from "hono";

export function registerPromotionRoutes(
  app: Hono,
  baseUrl: string | undefined,
  token: string,
) {
  app.all("/api/v1/promotion", forward);
  app.all("/api/v1/promotion/*", forward);
  async function forward(context: Context) {
    if (context.req.method !== "GET")
      return context.json({ error: "Read only" }, 405);
    if (baseUrl === undefined)
      return context.json({ error: "Promotion status is not configured" }, 503);
    if (
      !/^\/api\/v1\/promotion(?:\/history|\/evidence\/[a-f0-9]{64})?$/.test(
        context.req.path,
      )
    )
      return context.json({ error: "Not found" }, 404);
    try {
      const url = new URL(context.req.path, baseUrl);
      url.search = new URL(context.req.url).search;
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      return new Response(response.body, {
        status: response.status,
        headers: {
          "Content-Type":
            response.headers.get("content-type") ?? "application/json",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    } catch {
      return context.json({ error: "Promotion status is unavailable" }, 503);
    }
  }
}
