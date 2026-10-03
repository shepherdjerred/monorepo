import { loadToolkitConfig } from "#lib/toolkit-config.ts";
import { forumClientForAgent } from "#lib/forum/credentials.ts";

export type ForumArguments = {
  subcommand: string;
  agent: string | undefined;
  session: string | undefined;
  json: boolean;
  forum: string | undefined;
  page: number;
  id: number | undefined;
  query: string | undefined;
  title: string | undefined;
  bodyFile: string | undefined;
};

export async function forumCommand(args: ForumArguments): Promise<void> {
  if (args.subcommand === "open") {
    await openForum(args.id);
    return;
  }
  if (args.agent === undefined) throw new Error("--agent is required");
  const { client, identity } = await forumClientForAgent(
    args.agent,
    args.session,
  );
  switch (args.subcommand) {
    case "identity": {
      print(
        identity,
        `${identity.username} (user ${String(identity.userId)})\nSession: ${identity.sessionId}\n${identity.url}`,
        args.json,
      );
      break;
    }
    case "forums": {
      const forums = await client.forums();
      print(
        { forums },
        forums
          .map((forum) => `${String(forum.node_id)}\t${forum.title}`)
          .join("\n"),
        args.json,
      );
      break;
    }
    case "recent": {
      const result = await client.recent(args.page, args.forum);
      print(
        result,
        `${result.threads.map((thread) => `${String(thread.thread_id)}\t${thread.title} — ${thread.username} (${String(thread.reply_count)} replies)\n${thread.view_url}`).join("\n\n")}\n${pageSummary(result.pagination)}`,
        args.json,
      );
      break;
    }
    case "search": {
      if (args.query === undefined) throw new Error("Query is required");
      const result = await client.search(args.query, args.page, args.forum);
      print(
        result,
        `${result.results.map((hit) => `${String(hit.result.thread_id)}\t${hit.type === "post" ? hit.result.Thread.title : hit.result.title} — ${hit.result.username}\n${hit.result.view_url}`).join("\n\n")}\n${pageSummary(result.pagination)}`,
        args.json,
      );
      break;
    }
    case "show": {
      if (args.id === undefined) throw new Error("Thread ID is required");
      const result = await client.show(args.id, args.page);
      print(
        result,
        `${result.thread.title}\n${result.thread.view_url}\n\n${result.posts.map((post) => `${post.username} (post ${String(post.post_id)})\n${post.message}`).join("\n\n---\n\n")}\n\n${pageSummary(result.pagination)}`,
        args.json,
      );
      break;
    }
    case "post": {
      if (args.forum === undefined || args.title === undefined)
        throw new Error("Forum and title are required");
      const result = await client.post(
        args.forum,
        args.title,
        await readBody(args.bodyFile),
      );
      print(
        result,
        `Posted thread ${String(result.thread.thread_id)} as ${result.thread.username}: ${result.thread.view_url}`,
        args.json,
      );
      break;
    }
    case "reply": {
      if (args.id === undefined) throw new Error("Thread ID is required");
      const result = await client.reply(args.id, await readBody(args.bodyFile));
      print(
        result,
        `Replied as ${result.post.username}: ${result.post.view_url}`,
        args.json,
      );
      break;
    }
    default:
      throw new Error(`Unknown forum command: ${args.subcommand}`);
  }
}

async function openForum(id: number | undefined): Promise<void> {
  const config = await loadToolkitConfig();
  const configured = await config.value("forumUrl");
  const base = `${configured.replace(/\/$/, "")}/`;
  const url =
    id === undefined ? base : `${base}index.php?threads/${String(id)}/`;
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const child = Bun.spawn([command, url], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0)
    throw new Error("Could not open the forum browser");
}

function print(result: unknown, text: string, json: boolean): void {
  console.log(json ? JSON.stringify(result) : text);
}
function pageSummary(page: {
  current_page: number;
  last_page: number;
  total: number;
}): string {
  return page.total === 0
    ? "No results."
    : `Page ${String(page.current_page)}/${String(page.last_page)} (${String(page.total)} results)`;
}

async function readBody(path: string | undefined): Promise<string> {
  if (path === undefined) throw new Error("--body-file is required");
  const body = await Bun.file(path).text();
  if (body.trim() === "") throw new Error("Body file must not be empty");
  return body;
}
