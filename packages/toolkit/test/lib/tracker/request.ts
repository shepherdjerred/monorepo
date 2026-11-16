import { vi } from "vitest";
import { trackerClient } from "#lib/tracker/client.ts";

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

/** Build a test forum command context backed by a running Bun.serve fixture. */
export function testForumContext(server: ReturnType<typeof Bun.serve>) {
  const url = server.url.toString();
  const actor = vi.fn(() =>
    Promise.resolve({
      key: "codex:session",
      kind: "agent" as const,
      name: "Codex",
      metadata: {},
    }),
  );
  return {
    actor,
    url,
    context: { url, actor, client: trackerClient(url) },
  };
}
