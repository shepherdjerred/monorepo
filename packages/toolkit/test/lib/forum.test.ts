import { describe, expect, test, vi } from "vitest";
import { createForumClient } from "#lib/forum/client.ts";
import { parseForumArguments, handleForumCommand } from "#handlers/forum.ts";

const node = { node_id: 3, title: "Problems", node_type_id: "Forum" };
const thread = {
  thread_id: 7,
  node_id: 3,
  title: "A problem",
  username: "Codex",
  reply_count: 0,
  view_url: "http://127.0.0.1:8765/index.php?threads/7/",
};
const pagination = { current_page: 1, last_page: 1, total: 1 };
const post = {
  post_id: 9,
  thread_id: 7,
  username: "Claude",
  message: "A solution",
  view_url: "http://127.0.0.1:8765/index.php?posts/9/",
};

function requestUrl(input: Parameters<typeof fetch>[0] | undefined): string {
  if (input === undefined) throw new Error("Missing request");
  return input instanceof Request ? input.url : input.toString();
}
function formBody(body: RequestInit["body"]): URLSearchParams {
  if (!(body instanceof URLSearchParams)) throw new Error("Expected form body");
  return body;
}

function fixture(...responses: Response[]) {
  const fetcher = vi.fn<
    (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => Promise<Response>
  >(async () => {
    const response = responses.shift();
    if (response === undefined) throw new Error("Unexpected request");
    return response;
  });
  const client = createForumClient({
    baseUrl: "http://127.0.0.1:8765",
    apiKey: "test-key",
    fetch: Object.assign(fetcher, { preconnect: fetch.preconnect }),
  });
  return { client, fetcher };
}

describe("forum API boundary", () => {
  test("posts BBCode using the named forum and a user key", async () => {
    const { client, fetcher } = fixture(
      Response.json({ nodes: [node] }),
      Response.json({ success: true, thread }),
    );
    await expect(
      client.post("problems", "A & B", "[CODE]x=1&y=2[/CODE]\nContext"),
    ).resolves.toEqual({ success: true, thread });
    const [url, options] = fetcher.mock.calls[1]!;
    expect(requestUrl(url)).toBe("http://127.0.0.1:8765/api/threads/");
    expect(options?.redirect).toBe("error");
    expect(new Headers(options?.headers).get("XF-Api-Key")).toBe("test-key");
    expect(new Headers(options?.headers).get("Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    );
    const form = formBody(options?.body);
    expect(form.get("node_id")).toBe("3");
    expect(form.get("title")).toBe("A & B");
    expect(form.get("message")).toBe("[CODE]x=1&y=2[/CODE]\nContext");
    expect(form.get("discussion_type")).toBe("discussion");
  });

  test("cannot silently choose among ambiguous forums", async () => {
    const { client, fetcher } = fixture(
      Response.json({ nodes: [node, { ...node, node_id: 4 }] }),
    );
    await expect(client.post("Problems", "Title", "Body")).rejects.toThrow(
      "Expected one forum",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("preserves thread pages and includes old threads in recent results", async () => {
    const { client, fetcher } = fixture(
      Response.json({ thread, posts: [post], pagination }),
      Response.json({ threads: [thread], pagination }),
    );
    const shown = await client.show(7, 2);
    expect(shown.posts[0]?.username).toBe("Claude");
    expect(
      new URL(requestUrl(fetcher.mock.calls[0]?.[0])).searchParams.get("page"),
    ).toBe("2");
    await client.recent(1);
    expect(
      new URL(requestUrl(fetcher.mock.calls[1]?.[0])).searchParams.get(
        "last_days",
      ),
    ).toBe("0");
  });

  test("searches within a forum and reads the user-owned result set", async () => {
    const { client, fetcher } = fixture(
      Response.json({ nodes: [node] }),
      Response.json({ success: true, search: { search_id: 5 } }),
      Response.json({
        results: [
          { type: "post", id: 9, result: { ...post, Thread: thread } },
          { type: "thread", id: 7, result: thread },
        ],
        pagination,
      }),
    );
    const found = await client.search("solution", 1, "Problems");
    expect(found.results).toMatchObject([
      { type: "post", result: { Thread: { title: "A problem" } } },
      { type: "thread", result: { title: "A problem" } },
    ]);
    expect(formBody(fetcher.mock.calls[1]?.[1]?.body).get("c[nodes][]")).toBe(
      "3",
    );
    expect(requestUrl(fetcher.mock.calls[2]?.[0])).toBe(
      "http://127.0.0.1:8765/api/search/5/?page=1",
    );
  });

  test.each(["No results found.", "Aucun résultat trouvé."])(
    "message-only empty search response: %s",
    async (message) => {
      const { client, fetcher } = fixture(Response.json({ message }));
      const found = await client.search("nothing", 1);
      expect(found).toEqual({
        results: [],
        pagination: { current_page: 0, last_page: 0, total: 0 },
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  test("results disappearing between search creation and retrieval returns an empty page", async () => {
    const { client, fetcher } = fixture(
      Response.json({ success: true, search: { search_id: 5 } }),
      Response.json({ message: "No results found." }),
    );
    await expect(client.search("deleted", 1)).resolves.toEqual({
      results: [],
      pagination: { current_page: 0, last_page: 0, total: 0 },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test.each([
    { success: true },
    { message: 42 },
    { message: "No results found.", search: { search_id: 5 } },
    { message: "No results found.", errors: [{ code: "no_permission" }] },
  ])(
    "rejects malformed search responses without masking failures: %j",
    async (body) => {
      const { client } = fixture(Response.json(body));
      await expect(client.search("query", 1)).rejects.toThrow(
        "POST search/ contract",
      );
    },
  );

  test("search authorization errors retain their HTTP failure", async () => {
    const { client } = fixture(
      Response.json({ errors: [{ code: "no_permission" }] }, { status: 403 }),
    );
    await expect(client.search("query", 1)).rejects.toThrow(
      "Forum HTTP 403: no_permission",
    );
  });

  test("empty XenForo thread lists use page zero", async () => {
    const { client } = fixture(
      Response.json({
        threads: [],
        pagination: { current_page: 0, last_page: 0, total: 0 },
      }),
    );
    await expect(client.recent(1)).resolves.toEqual({
      threads: [],
      pagination: { current_page: 0, last_page: 0, total: 0 },
    });
  });

  test("rejects malformed successful responses without exposing their contents", async () => {
    const { client } = fixture(Response.json({ thread: "test-key" }));
    await expect(client.show(7, 1)).rejects.toThrow("does not match");
  });

  test("redacts server diagnostics and never retries failed writes", async () => {
    const { client, fetcher } = fixture(
      Response.json(
        { errors: [{ code: "no_permission", message: "test-key" }] },
        { status: 403 },
      ),
    );
    await expect(client.reply(7, "Body")).rejects.toThrow(
      "Forum HTTP 403: no_permission",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("rejects URLs containing credentials", () => {
    expect(() =>
      createForumClient({
        baseUrl: "http://name:password@localhost",
        apiKey: "key",
      }),
    ).toThrow("must not contain credentials");
  });
});

describe("forum CLI arguments", () => {
  test("writes require an identity, area, title and body file", () => {
    expect(
      parseForumArguments("post", [
        "--agent",
        "codex",
        "--forum",
        "Problems",
        "--title",
        "Title",
        "--body-file",
        "/tmp/body",
      ]),
    ).toMatchObject({
      agent: "codex",
      forum: "Problems",
      title: "Title",
      bodyFile: "/tmp/body",
    });
    expect(() => parseForumArguments("post", ["--agent", "codex"])).toThrow(
      "body-file",
    );
    expect(() => parseForumArguments("forums", [])).toThrow("--agent");
  });

  test.each(["0", "-1", "1x", "1.5", "9007199254740992"])(
    "rejects invalid thread ID %s",
    (id) => {
      expect(() =>
        parseForumArguments("show", ["--agent", "codex", id]),
      ).toThrow();
    },
  );

  test("rejects extra positionals and flags instead of ignoring them", () => {
    expect(() =>
      parseForumArguments("recent", ["--agent", "codex", "stray"]),
    ).toThrow("Unexpected arguments");
    expect(() =>
      parseForumArguments("recent", ["--agent", "codex", "--unknown"]),
    ).toThrow();
    expect(parseForumArguments("open", ["7"]).id).toBe(7);
  });

  test("invalid invocation produces a nonzero exit without contacting the API", async () => {
    const previous = process.exitCode;
    const error = vi.spyOn(console, "error").mockImplementation(() => {
      /* suppress expected CLI diagnostic */
    });
    try {
      await handleForumCommand("show", []);
      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("--agent"));
    } finally {
      process.exitCode = previous;
      error.mockRestore();
    }
  });
});
