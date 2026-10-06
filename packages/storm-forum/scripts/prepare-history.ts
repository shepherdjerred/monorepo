import { cp, mkdir } from "node:fs/promises";
import { z } from "zod";
import { format } from "prettier";
import {
  LegacyHistorySchema,
  historicalDate,
  restoreMessage,
} from "#src/history.ts";
import restorations from "#config/history-restorations.json";

const source = Bun.argv[2];
if (source === undefined || source === "")
  throw new Error(
    "Usage: prepare-history.ts <read-only The Storm archive directory>",
  );
const sourceRoot = new URL(`file://${source.replace(/\/$/, "")}/`);
const root = new URL("../", import.meta.url);
const PostSchema = z.object({
  post_id: z.coerce.number().int().positive(),
  author: z.string(),
  date: z.string().nullable(),
  date_text: z.string(),
  text: z.string(),
  seen_in: z.string(),
});
const ThreadSchema = z.object({
  thread_id: z.number(),
  title: z.string(),
  slug: z.string(),
  forum: z.string(),
  captures: z.array(
    z.object({ wayback: z.string() }).transform((capture) => capture.wayback),
  ),
  posts: z.array(PostSchema),
});
const NewsSchema = z.object({
  thread_id: z.coerce.number(),
  title: z.string(),
  author: z.string(),
  date: z.string().nullable(),
  date_text: z.string(),
  body: z.string(),
  seen_in: z.array(z.string()),
  url: z.string(),
});
async function rows<T>(file: string, schema: z.ZodType<T>): Promise<T[]> {
  const text = await Bun.file(
    new URL(`Research/analysis/${file}`, sourceRoot),
  ).text();
  return text
    .trim()
    .split("\n")
    .map((row) => schema.parse(JSON.parse(row)));
}
const images = new Map<string, string>();
const imageSources = new Map<string, URL>();
const destination = new URL("assets/history/", root);
await mkdir(destination, { recursive: true });
// The reviewed asset indexes identify public post imagery; desktop personal files are excluded.
for (const directory of ["forum", "site"]) {
  const index = await Bun.file(
    new URL(`Assets/${directory}/INDEX.md`, sourceRoot),
  ).text();
  for (const row of index.split("\n")) {
    const file = /\| `([^`]+\.(?:png|jpg))` \|/.exec(row)?.[1];
    if (
      file === undefined ||
      file.startsWith("t290_") ||
      !file.startsWith("t") ||
      (directory === "site" && !file.startsWith("tsmc_attach"))
    )
      continue;
    const url =
      directory === "forum"
        ? /https:\/\/i\.imgur\.com\/[^\s|]+/.exec(row)?.[0]
        : /ts-mc\.net\/attachments\/[^\s|]+/.exec(row)?.[0];
    if (url === undefined) continue;
    const filename = file.replaceAll(/[^\w.-]/g, "-");
    images.set(directory === "forum" ? url : `https://${url}`, filename);
    imageSources.set(
      filename,
      new URL(`Assets/${directory}/${file}`, sourceRoot),
    );
  }
}
const sourceThreads = await rows("threads.jsonl", ThreadSchema);
const news = await rows("news.jsonl", NewsSchema);
const nodes: Record<
  string,
  "news" | "general" | "feedback" | "bugs" | "games"
> = {
  Announcements: "news",
  "News & Announcements": "news",
  "Forum Games": "games",
  "Bug Reports": "bugs",
  Suggestions: "feedback",
  Feedback: "feedback",
  General: "general",
  Chaos: "general",
  Lysergia: "general",
  "Community Voting": "general",
  Towns: "general",
  Boomerville: "general",
  Keystone: "general",
};
const threads = [],
  omitted = [];
const present = new Set(sourceThreads.map((thread) => thread.thread_id));
for (const thread of sourceThreads) {
  if (/reports|appeals|staff|application|private/i.test(thread.forum)) {
    omitted.push({
      originalId: thread.thread_id,
      reason: "Private or moderation content excluded",
    });
    continue;
  }
  const posts = [
    ...new Map(thread.posts.map((post) => [post.post_id, post])).values(),
  ]
    .map((post) => ({
      key: `${String(thread.thread_id)}:${String(post.post_id)}`,
      author: post.author,
      date: historicalDate(post.date, post.date_text),
      message: restoreMessage(post.text, images),
    }))
    .filter((post) => post.message.length > 0)
    .sort((a, b) => a.date - b.date);
  const node = nodes[thread.forum];
  if (node === undefined)
    throw new Error(`Unknown historical forum: ${thread.forum}`);
  threads.push({
    originalId: thread.thread_id,
    slug: thread.slug,
    title: thread.title,
    node,
    reconstructed: false,
    sources: thread.captures,
    posts,
  });
}
const edits = z
  .record(
    z.string(),
    z.object({ cutAt: z.string(), ending: z.string(), reason: z.string() }),
  )
  .parse(restorations);
for (const item of news) {
  if (present.has(item.thread_id)) continue;
  if (item.body.split(/\s+/).length < 150) {
    omitted.push({
      originalId: item.thread_id,
      reason: "Insufficient surviving announcement text",
    });
    continue;
  }
  const edit = edits[String(item.thread_id)];
  let body = item.body;
  if (edit) {
    const index = body.indexOf(edit.cutAt);
    if (index === -1)
      throw new Error(`Restoration anchor missing: ${String(item.thread_id)}`);
    body = body.slice(0, index) + edit.ending;
  } else if (body.endsWith("..."))
    throw new Error(
      `Unreviewed truncated announcement: ${String(item.thread_id)}`,
    );
  const slug = new URL(item.url).pathname
    .split("/")
    .find((part) => part.endsWith(`.${String(item.thread_id)}`))
    ?.replace(new RegExp(String.raw`\.${String(item.thread_id)}$`), "");
  if (slug === undefined || slug === "")
    throw new Error("Historical announcement URL has no slug");
  threads.push({
    originalId: item.thread_id,
    slug,
    title: item.title,
    node: "news",
    reconstructed: edit !== undefined,
    sources: item.seen_in,
    posts: [
      {
        key: `${String(item.thread_id)}:1`,
        author: item.author,
        date: historicalDate(item.date, item.date_text),
        message: restoreMessage(body, images),
      },
    ],
  });
}
const history = LegacyHistorySchema.parse({
  version: 1,
  threads: threads.sort((a, b) => a.originalId - b.originalId),
  omitted,
});
const usedImages = new Set(
  history.threads.flatMap((thread) =>
    thread.posts.flatMap((post) =>
      [
        ...post.message.matchAll(
          /\[IMG\]\/data\/storm-history\/([\w.-]+)\[\/IMG\]/g,
        ),
      ].map((match) => match[1]),
    ),
  ),
);
for (const file of usedImages) {
  if (file === undefined) throw new Error("Missing historical image filename");
  const original = imageSources.get(file);
  if (original === undefined)
    throw new Error(`Missing recovered historical image: ${file}`);
  await cp(original, new URL(file, destination));
}
await Bun.write(
  new URL("config/history.json", root),
  await format(JSON.stringify(history), { parser: "json" }),
);
process.stdout.write(
  `Prepared ${String(history.threads.length)} public threads, ${String(history.threads.reduce((n, t) => n + t.posts.length, 0))} posts, ${String(usedImages.size)} referenced images; ${String(omitted.length)} omitted.\n`,
);
