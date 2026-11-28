export type HostHandlers = {
  appHost: string;
  contentHost: string;
  app: (request: Request) => Promise<Response> | Response;
  content: (request: Request) => Promise<Response> | Response;
  internal: (request: Request) => Promise<Response> | Response;
};

/** The `Host` of an origin, as a client sends it (port included when set). */
export function hostOf(origin: string): string {
  return new URL(origin).host.toLowerCase();
}

/**
 * One listener, three host classes. The app and content hosts are named by
 * bootstrap configuration; any other `Host` (service DNS, a pod IP) is the
 * internal class, which serves health, readiness, metrics and maintenance.
 */
export function routeByHost(handlers: HostHandlers) {
  return (request: Request): Promise<Response> | Response => {
    const host = (request.headers.get("host") ?? "").toLowerCase();
    if (host === handlers.appHost) return handlers.app(request);
    return host === handlers.contentHost
      ? handlers.content(request)
      : handlers.internal(request);
  };
}
