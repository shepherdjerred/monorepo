const port = Number(Bun.env.PORT ?? 8788);

const hostname = "127.0.0.1";

Bun.serve({
  hostname,
  port,
  async fetch(request) {
    const startedAt = performance.now();
    const requestId = crypto.randomUUID();
    const pathname = new URL(request.url).pathname;
    if (pathname === "/" || pathname === "/index.html") {
      const response = new Response(
        Bun.file(new URL("./index.html", import.meta.url)),
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
      logRequest(request, requestId, pathname, response.status, startedAt);
      return response;
    }
    const response = new Response("Not found", { status: 404 });
    logRequest(request, requestId, pathname, response.status, startedAt);
    return response;
  },
});

console.info(
  JSON.stringify({
    event: "demo_server_started",
    bind: hostname,
    port,
    health_path: "/",
  }),
);

function logRequest(
  request: Request,
  requestId: string,
  pathname: string,
  status: number,
  startedAt: number,
) {
  console.info(
    JSON.stringify({
      event: "demo_http_request",
      request_id: requestId,
      method: request.method,
      path: pathname,
      status,
      duration_ms: Math.round(performance.now() - startedAt),
    }),
  );
}
