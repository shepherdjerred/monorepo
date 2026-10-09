import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "htmlparser2";
import { format } from "prettier";
import { z } from "zod";
import {
  archiveBBCode,
  findAll,
  hasClass,
  textContent,
} from "#src/archive-html.ts";
import { HistorySchema, historicalDate } from "#src/history.ts";

// Add captured public material without re-enriching checkpointed identities or media.
const archive = Bun.argv[2];
if (archive === undefined)
  throw new Error(
    "Usage: expand-history.ts <read-only The Storm archive directory>",
  );
const root = path.resolve(import.meta.dirname, "..");
const research = path.join(archive, "Research");
const destination = path.join(root, "config/history.json");
const history = HistorySchema.parse(await Bun.file(destination).json());
const hash = (message: string) =>
  createHash("sha256").update(message).digest("hex");
const Row = z.object({
  thread_id: z.coerce.number(),
  forum: z.string(),
  captures: z.array(z.object({ file: z.string(), ts: z.string() })),
  posts: z.array(
    z.object({
      post_id: z.coerce.number(),
      author: z.string(),
      date: z.string().nullable(),
      date_text: z.string(),
    }),
  ),
});
const News = z.object({
  thread_id: z.coerce.number(),
  title: z.string(),
  author: z.string(),
  date: z.string().nullable(),
  date_text: z.string(),
  url: z.url(),
  seen_in: z.array(z.url()),
});
const rowsText = await Bun.file(
  path.join(research, "analysis/threads.jsonl"),
).text();
const rows = rowsText
  .trim()
  .split("\n")
  .map((row) => Row.parse(JSON.parse(row)));
const newsText = await Bun.file(
  path.join(research, "analysis/news.jsonl"),
).text();
const news = newsText
  .trim()
  .split("\n")
  .map((row) => News.parse(JSON.parse(row)));
const nodes: Record<
  string,
  z.infer<typeof HistorySchema>["threads"][number]["node"]
> = {
  Chaos: "chaos",
  "Community Voting": "voting",
  Towns: "towns",
  Lysergia: "lysergia",
  Boomerville: "boomerville",
  Keystone: "keystone",
};
const images = new Map<string, string>();
const recoveredIds = new Set(
  history.attachments
    .filter((asset) => (asset.era ?? "original") === "original")
    .map((asset) => asset.originalId),
);
for (const filename of await readdir(path.join(root, "assets/history"))) {
  const match = /^giphy-(\w+)\.gif$/.exec(filename);
  if (match?.[1] !== undefined)
    images.set(`https://media.giphy.com/media/${match[1]}/giphy.gif`, filename);
}
const identity = (author: string) => {
  const matches = history.users.filter(
    (user) =>
      (user.era ?? "original") === "original" && user.aliases.includes(author),
  );
  if (matches.length !== 1 || matches[0] === undefined)
    throw new Error(`No unambiguous captured identity: ${author}`);
  return matches[0].originalId;
};
let addedPosts = 0;
for (const row of rows) {
  const thread = history.threads.find(
    (item) =>
      (item.era ?? "original") === "original" &&
      item.originalId === row.thread_id,
  );
  if (thread === undefined) continue; // Private/excluded content remains excluded.
  const node = nodes[row.forum];
  if (node !== undefined) thread.node = node;
  const missing = new Map(
    row.posts
      .filter(
        (post) =>
          !thread.posts.some((item) => item.originalPostId === post.post_id),
      )
      .map((post) => [post.post_id, post]),
  );
  const bodies = new Map<number, { message: string; captured: string }>();
  for (const capture of row.captures) {
    if (missing.size === 0) break;
    const doc = parseDocument(
      await Bun.file(path.join(research, capture.file)).text(),
    );
    for (const messageElement of findAll(
      (element) => element.name === "li" && hasClass(element, "message"),
      doc.children,
    )) {
      const id = Number(messageElement.attribs["id"]?.replace(/^post-/, ""));
      const body = findAll(
        (element) => hasClass(element, "messageText"),
        messageElement.children,
      )[0];
      if (
        body === undefined ||
        !missing.has(id) ||
        (bodies.get(id)?.captured ?? "") >= capture.ts
      )
        continue;
      bodies.set(id, {
        message: archiveBBCode(body, images, recoveredIds),
        captured: capture.ts,
      });
    }
  }
  for (const [id, post] of missing) {
    const message = bodies.get(id)?.message;
    if (message === undefined || message === "") continue;
    thread.posts.push({
      key: `${String(thread.originalId)}:${String(id)}`,
      originalPostId: id,
      originalUserId: identity(post.author),
      author: post.author,
      date: historicalDate(post.date, post.date_text),
      message,
      previousMessageHash: hash(message),
      attachments: [],
    });
    addedPosts++;
  }
  thread.posts.sort(
    (left, right) =>
      left.date - right.date ||
      (left.originalPostId ?? 0) - (right.originalPostId ?? 0),
  );
}
const candidates = new Map<
  number,
  { message: string; originalUserId: number }
>();
const existing = new Set(
  history.threads
    .filter((thread) => (thread.era ?? "original") === "original")
    .map((thread) => thread.originalId),
);
const mirror = path.join(research, "mirror/ts-mc.net");
let addedIdentities = 0;
const memberFiles = await readdir(mirror);
for (const filename of memberFiles.sort()) {
  const captured = /^members__(\d{14})\.html$/.exec(filename)?.[1];
  if (captured === undefined) continue;
  const doc = parseDocument(await Bun.file(path.join(mirror, filename)).text());
  for (const anchor of findAll(
    (element) => element.name === "a" && hasClass(element, "username"),
    doc.children,
  )) {
    const member = /members\/([^/]+)\.(\d+)\//.exec(
      anchor.attribs["href"] ?? "",
    );
    if (member?.[1] === undefined || member[2] === undefined) continue;
    const originalId = Number(member[2]);
    if (
      history.users.some(
        (user) =>
          (user.era ?? "original") === "original" &&
          user.originalId === originalId,
      )
    )
      continue;
    const username = textContent(anchor).trim();
    if (
      history.users.some(
        (user) =>
          (user.era ?? "original") === "original" &&
          user.aliases.some(
            (alias) => alias.toLowerCase() === username.toLowerCase(),
          ),
      )
    )
      throw new Error(`Conflicting captured public member: ${username}`);
    history.users.push({
      originalId,
      username,
      aliases: [username],
      slugs: [member[1]],
      captured,
      avatar: null,
    });
    addedIdentities++;
  }
}
history.users.sort(
  (left, right) =>
    (left.era ?? "original").localeCompare(right.era ?? "original") ||
    left.originalId - right.originalId,
);
for (const filename of await readdir(mirror)) {
  if (!/^(?:index|articles)__.*\.html$/.test(filename)) continue;
  const doc = parseDocument(await Bun.file(path.join(mirror, filename)).text());
  for (const article of findAll(
    (element) => hasClass(element, "recentNews"),
    doc.children,
  )) {
    const title = findAll(
      (element) => hasClass(element, "newsTitle"),
      article.children,
    )[0];
    const id = Number(/\.(\d+)\//.exec(title?.attribs["href"] ?? "")?.[1]);
    if (existing.has(id) || !news.some((item) => item.thread_id === id))
      continue;
    const body = findAll(
      (element) => hasClass(element, "newsText"),
      article.children,
    )[0];
    const author = findAll(
      (element) => element.name === "a" && hasClass(element, "username"),
      article.children,
    )[0];
    if (body === undefined || author === undefined) continue;
    const message = archiveBBCode(body, images, recoveredIds);
    if (message.length <= (candidates.get(id)?.message.length ?? 0)) continue;
    candidates.set(id, {
      message,
      originalUserId: identity(textContent(author).trim()),
    });
  }
}
let addedThreads = 0;
for (const item of news) {
  if (existing.has(item.thread_id)) continue;
  const recovered = candidates.get(item.thread_id);
  if (recovered === undefined)
    throw new Error(
      `Announcement has no captured HTML body: ${String(item.thread_id)}`,
    );
  if (recovered.originalUserId !== identity(item.author))
    throw new Error("Captured announcement author disagrees with index");
  const slug = new URL(item.url).pathname
    .split("/")
    .find((part) => part.endsWith(`.${String(item.thread_id)}`))
    ?.replace(/\.\d+$/, "");
  if (slug === undefined) throw new Error("Announcement has no original slug");
  history.threads.push({
    originalId: item.thread_id,
    slug,
    title: item.title,
    node: "news",
    reconstructed: false,
    sources: item.seen_in,
    posts: [
      {
        key: `${String(item.thread_id)}:1`,
        originalPostId: null,
        originalUserId: recovered.originalUserId,
        author: item.author,
        date: historicalDate(item.date, item.date_text),
        message: recovered.message,
        previousMessageHash: hash(recovered.message),
        attachments: [],
      },
    ],
  });
  addedThreads++;
  addedPosts++;
}
history.threads.sort(
  (left, right) =>
    (left.era ?? "original").localeCompare(right.era ?? "original") ||
    left.originalId - right.originalId,
);
history.omitted = history.omitted.filter(
  (item) =>
    !history.threads.some(
      (thread) =>
        (thread.era ?? "original") === "original" &&
        thread.originalId === item.originalId,
    ),
);
await Bun.write(
  destination,
  await format(JSON.stringify(HistorySchema.parse(history)), {
    parser: "json",
  }),
);
process.stdout.write(
  `Added ${String(addedThreads)} captured announcements, ${String(addedPosts)} posts and ${String(addedIdentities)} public identities; retained existing identity/media checkpoints and reconstructed endings.\n`,
);
