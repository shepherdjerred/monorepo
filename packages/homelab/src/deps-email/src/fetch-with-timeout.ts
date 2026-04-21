// Bare `fetch()` inherits no timeout; a single slow/hung endpoint (seen on
// api.github.com and artifacthub.io during regional outages) can stall the
// whole weekly job until the outer 5-minute bash timeout kills it.
// `fetchWithTimeout` aborts each request after `timeoutMs` so at most one
// slow host adds `timeoutMs` to the total wall time.
export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
