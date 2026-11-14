/** Parse the single-operation tRPC transport used by toolkit fixture servers. */
export async function trackerRequest(request: Request) {
  const url = new URL(request.url);
  const input: unknown =
    request.method === "GET"
      ? JSON.parse(url.searchParams.get("input") ?? "{}")
      : await request.json();
  return {
    procedure: url.pathname.slice("/trpc/".length),
    input,
    method: request.method,
  };
}
