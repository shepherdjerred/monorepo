/** Answers the kubelet probes and the image smoke run. */
export function handle(request: Request): Response {
  return new URL(request.url).pathname === "/healthz"
    ? new Response("ok")
    : new Response("not found", { status: 404 });
}

export function startServer(port: number, hostname: string) {
  const server = Bun.serve({ port, hostname, fetch: handle });
  console.warn(`artifacts listening on :${String(server.port)}`);
  return server;
}
