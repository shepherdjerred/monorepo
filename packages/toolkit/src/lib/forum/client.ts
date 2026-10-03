import { z } from "zod";

const Id = z.number().int().positive();
export const NodeSchema = z.object({
  node_id: Id,
  title: z.string(),
  node_type_id: z.string(),
});
export const ThreadSchema = z.object({
  thread_id: Id,
  node_id: Id,
  title: z.string(),
  username: z.string(),
  reply_count: z.number().int().nonnegative(),
  view_url: z.url(),
});
export const PostSchema = z.object({
  post_id: Id,
  thread_id: Id,
  username: z.string(),
  message: z.string(),
  view_url: z.url(),
});
const Pagination = z.object({
  current_page: z.number().int().nonnegative(),
  last_page: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
const Nodes = z.object({ nodes: z.array(NodeSchema) });
const Threads = z.object({
  threads: z.array(ThreadSchema),
  pagination: Pagination,
});
const Thread = z.object({
  thread: ThreadSchema,
  posts: z.array(PostSchema),
  pagination: Pagination,
});
const CreatedThread = z.object({
  success: z.literal(true),
  thread: ThreadSchema,
});
const CreatedPost = z.object({ success: z.literal(true), post: PostSchema });
// XenForo's renderMessage returns only { message }, without a success flag.
// Both search creation and retrieval use it when no visible results remain.
const NoSearchResults = z.strictObject({ message: z.string().min(1) });
const Search = z.union([
  z.object({ success: z.literal(true), search: z.object({ search_id: Id }) }),
  NoSearchResults,
]);
const SearchPage = z.object({
  results: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("post"),
        id: Id,
        result: PostSchema.extend({ Thread: ThreadSchema }),
      }),
      z.object({ type: z.literal("thread"), id: Id, result: ThreadSchema }),
    ]),
  ),
  pagination: Pagination,
});
const SearchResults = z.union([SearchPage, NoSearchResults]);
const Errors = z.object({ errors: z.array(z.object({ code: z.string() })) });

export type ForumClientOptions = {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
};

/** XenForo uses form bodies and XF-Api-Key, unlike toolkit's JSON service clients. */
export function createForumClient(options: ForumClientOptions) {
  const base = new URL(`${options.baseUrl.replace(/\/$/, "")}/api/`);
  if (base.username || base.password)
    throw new Error("Forum URL must not contain credentials");
  const fetcher = options.fetch ?? fetch;

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    schema: z.ZodType<T>,
    fields: Record<string, string> = {},
  ): Promise<T> {
    const url = new URL(path, base);
    const params = new URLSearchParams(fields);
    if (method === "GET") url.search = params.toString();
    let response: Response;
    try {
      response = await fetcher(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "XF-Api-Key": options.apiKey,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        ...(method === "POST" ? { body: params } : {}),
      });
    } catch {
      throw new Error(
        `Forum request failed: ${method} ${path}. Check that the local forum is running; writes are not retried.`,
      );
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new Error(
        `Forum returned non-JSON (HTTP ${String(response.status)})`,
      );
    }
    if (!response.ok) {
      const errors = Errors.safeParse(json);
      const codes = errors.success
        ? errors.data.errors
            .map(({ code }) =>
              code
                .replaceAll(options.apiKey, "[redacted]")
                .replaceAll(/\W/g, "")
                .slice(0, 100),
            )
            .join(", ")
        : "request_rejected";
      throw new Error(`Forum HTTP ${String(response.status)}: ${codes}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new Error(
        `Forum response does not match the ${method} ${path} contract`,
      );
    return parsed.data;
  }

  async function forums() {
    const result = await request("GET", "nodes/", Nodes);
    return result.nodes.filter((node) => node.node_type_id === "Forum");
  }
  async function forumId(name: string): Promise<number> {
    const available = await forums();
    const matches = available.filter(
      ({ title }) => title.toLowerCase() === name.toLowerCase(),
    );
    const match = matches[0];
    if (match === undefined || matches.length !== 1)
      throw new Error(
        `Expected one forum named ${name}; use 'toolkit forum forums' to inspect available areas`,
      );
    return match.node_id;
  }
  return {
    forums,
    async recent(page: number, name?: string) {
      const path =
        name === undefined
          ? "threads/"
          : `forums/${String(await forumId(name))}/threads/`;
      return request("GET", path, Threads, {
        page: String(page),
        last_days: "0",
        order: "last_post_date",
        direction: "desc",
      });
    },
    async show(id: number, page: number) {
      return request("GET", `threads/${String(id)}/`, Thread, {
        with_posts: "1",
        page: String(page),
      });
    },
    async post(name: string, title: string, message: string) {
      return request("POST", "threads/", CreatedThread, {
        node_id: String(await forumId(name)),
        title,
        message,
        discussion_type: "discussion",
      });
    },
    async reply(id: number, message: string) {
      return request("POST", "posts/", CreatedPost, {
        thread_id: String(id),
        message,
      });
    },
    async search(query: string, page: number, name?: string) {
      const fields: Record<string, string> = {
        keywords: query,
        search_type: "post",
        grouped: "1",
      };
      if (name !== undefined)
        fields["c[nodes][]"] = String(await forumId(name));
      const result = await request("POST", "search/", Search, fields);
      if ("message" in result) return emptySearchResults();
      const pageResult = await request(
        "GET",
        `search/${String(result.search.search_id)}/`,
        SearchResults,
        { page: String(page) },
      );
      return "message" in pageResult ? emptySearchResults() : pageResult;
    },
  };
}

function emptySearchResults() {
  return {
    results: [],
    pagination: { current_page: 0, last_page: 0, total: 0 },
  };
}
