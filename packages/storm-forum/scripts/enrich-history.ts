import { createHash } from "node:crypto";
import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "htmlparser2";
import { format } from "prettier";
import { z } from "zod";
import {
  archiveBBCode,
  findAll,
  hasClass,
  originalUrl,
  textContent,
  type ArchiveElement,
} from "#src/archive-html.ts";
import {
  HistorySchema,
  LegacyHistorySchema,
  restoreMessage,
} from "#src/history.ts";
import restorations from "#config/history-restorations.json";

const archive = Bun.argv[2];
if (archive === undefined || archive === "")
  throw new Error(
    "Usage: enrich-history.ts <read-only The Storm archive directory> [--public-archives]",
  );
const root = path.resolve(import.meta.dirname, ".."),
  research = path.join(archive, "Research"),
  assetRoot = path.join(root, "assets/history");
const corpus = z
  .union([HistorySchema, LegacyHistorySchema])
  .parse(
    JSON.parse(await Bun.file(path.join(root, "config/history.json")).text()),
  );
const RowSchema = z.object({
  thread_id: z.number(),
  captures: z.array(z.object({ file: z.string(), ts: z.string() })),
  posts: z.array(
    z.object({
      post_id: z.coerce.number(),
      attachments: z
        .array(z.object({ href: z.string(), name: z.string() }))
        .optional(),
    }),
  ),
});
const rowsText = await Bun.file(
  path.join(research, "analysis/threads.jsonl"),
).text();
const rows = rowsText
  .trim()
  .split("\n")
  .map((row) => RowSchema.parse(JSON.parse(row)));
const NewsSchema = z.object({ thread_id: z.coerce.number(), body: z.string() });
const newsText = await Bun.file(
  path.join(research, "analysis/news.jsonl"),
).text();
const news = newsText
  .trim()
  .split("\n")
  .map((row) => NewsSchema.parse(JSON.parse(row)));
const edits = z
  .record(
    z.string(),
    z.object({ cutAt: z.string(), ending: z.string(), reason: z.string() }),
  )
  .parse(restorations);
const included = new Set(corpus.threads.map((t) => t.originalId));
const sourceThreadIds = new Set(rows.map((t) => t.thread_id));
const portalBodies = new Map<number, ArchiveElement>();
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
type User = z.infer<typeof HistorySchema>["users"][number];
type Asset = {
  originalId: number;
  url: string;
  filename: string;
  file: string | null;
  sha256: string | null;
};
const users = new Map<number, User>(),
  names = new Map<string, number>();
const bodies = new Map<string, { body: ArchiveElement; captured: string }>();
const attachments = new Map<number, Asset>(),
  images = new Map<string, string>();
const attachmentCandidates = new Map<number, string>();
const missing: { url: string; reason: string }[] = [];
await mkdir(assetRoot, { recursive: true });

function rememberAttachment(href: string, filename?: string): void {
  const url = originalUrl(href);
  if (url === undefined) return;
  const id = /\/attachments\/[^/]*\.(\d+)\//.exec(url)?.[1];
  if (id === undefined) return;
  const existing = attachments.get(Number(id));
  if (existing !== undefined) {
    if (filename !== undefined) existing.filename = filename;
    return;
  }
  const inferred = new URL(url).pathname
    .split("/")
    .at(-2)
    ?.replace(/\.\d+$/, "")
    .replace(/-(png|jpg|gif)$/i, ".$1");
  attachments.set(Number(id), {
    originalId: Number(id),
    url,
    filename: filename ?? inferred ?? `attachment-${id}.png`,
    file: null,
    sha256: null,
  });
}
function captureIdentity(message: ArchiveElement, captured: string): void {
  const author = findAll(
    (n) => n.name === "a" && hasClass(n, "username"),
    message.children,
  )[0];
  const member = author?.attribs["href"]?.match(/members\/([^/]+)\.(\d+)\//);
  if (
    author === undefined ||
    member?.[1] === undefined ||
    member[2] === undefined
  )
    return;
  const username = textContent(author).trim(),
    id = Number(member[2]);
  if (names.has(username) && names.get(username) !== id)
    throw new Error(`Ambiguous historical identity: ${username}`);
  names.set(username, id);
  const user = users.get(id) ?? {
    originalId: id,
    username,
    aliases: [],
    slugs: [],
    captured,
    avatar: null,
  };
  if (!user.aliases.includes(username)) user.aliases.push(username);
  if (!user.slugs.includes(member[1])) user.slugs.push(member[1]);
  if (captured >= user.captured) {
    user.username = username;
    user.captured = captured;
  }
  users.set(id, user);
}
function captureBody(
  message: ArchiveElement,
  threadId: number,
  captured: string,
): void {
  const postId = message.attribs["id"]?.replace(/^post-/, "");
  const body = findAll((n) => hasClass(n, "messageText"), message.children)[0];
  if (body === undefined || postId === undefined) return;
  const key = `${String(threadId)}:${postId}`;
  if (captured <= (bodies.get(key)?.captured ?? "")) return;
  bodies.set(key, { body, captured });
  for (const image of findAll((n) => n.name === "img", body.children))
    rememberAttachment(image.attribs["data-url"] ?? image.attribs["src"] ?? "");
}
for (const directory of ["forum", "site"]) {
  const index = await Bun.file(
    path.join(archive, `Assets/${directory}/INDEX.md`),
  ).text();
  for (const row of index.split("\n")) {
    const filename = /\| `([^`]+\.(?:png|jpg))` \|/.exec(row)?.[1],
      href = /https:\/\/i\.imgur\.com\/[^\s|]+/.exec(row)?.[0];
    if (
      filename !== undefined &&
      href !== undefined &&
      !filename.startsWith("t290_")
    )
      images.set(href, filename);
  }
}
for (const filename of await readdir(path.join(archive, "Assets/site"))) {
  const id = /^tsmc_attach(\d+)_/.exec(filename)?.[1];
  if (id !== undefined)
    attachmentCandidates.set(
      Number(id),
      path.join(archive, "Assets/site", filename),
    );
}
for (const thread of rows.filter((t) => included.has(t.thread_id))) {
  for (const capture of thread.captures) {
    const doc = parseDocument(
      await Bun.file(path.join(research, capture.file)).text(),
    );
    for (const message of findAll(
      (n) => n.name === "li" && hasClass(n, "message"),
      doc.children,
    )) {
      captureIdentity(message, capture.ts);
      captureBody(message, thread.thread_id, capture.ts);
    }
  }
  for (const post of thread.posts)
    for (const item of post.attachments ?? [])
      rememberAttachment(item.href, item.name);
}
for (const filename of await readdir(path.join(research, "mirror/ts-mc.net"))) {
  if (!/^(?:index|articles)__.*\.html$/.test(filename)) continue;
  const doc = parseDocument(
    await Bun.file(path.join(research, "mirror/ts-mc.net", filename)).text(),
  );
  for (const item of findAll((n) => hasClass(n, "recentNews"), doc.children)) {
    const title = findAll((n) => hasClass(n, "newsTitle"), item.children)[0];
    const id = Number(/\.(\d+)\//.exec(title?.attribs["href"] ?? "")?.[1]);
    if (!included.has(id) || sourceThreadIds.has(id)) continue;
    const body = findAll((n) => hasClass(n, "newsText"), item.children)[0];
    if (body === undefined) continue;
    const previous = portalBodies.get(id);
    if (
      previous === undefined ||
      textContent(body).length > textContent(previous).length
    )
      portalBodies.set(id, body);
  }
}
for (const body of portalBodies.values())
  for (const image of findAll((n) => n.name === "img", body.children))
    rememberAttachment(image.attribs["data-url"] ?? image.attribs["src"] ?? "");
for (const thread of corpus.threads.filter(
  (t) => !sourceThreadIds.has(t.originalId),
)) {
  const item = news.find((n) => n.thread_id === thread.originalId);
  for (const match of item?.body.matchAll(/\[img ([^\]]+)\]/gi) ?? [])
    rememberAttachment(match[1] ?? "");
}

function imageKind(bytes: Uint8Array): "jpg" | "png" | "gif" | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  return String.fromCodePoint(...bytes.slice(0, 3)) === "GIF"
    ? "gif"
    : undefined;
}
async function archivedBytes(url: string): Promise<Uint8Array | undefined> {
  const query = new URL("https://web.archive.org/cdx/search/cdx");
  query.search = new URLSearchParams({
    url: url.replace(/^https:/, "http:"),
    output: "json",
    filter: "statuscode:200",
    collapse: "digest",
  }).toString();
  const response = await fetch(query, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`CDX HTTP ${String(response.status)}`);
  const captures = z.array(z.array(z.string())).parse(await response.json());
  for (const capture of captures.slice(1).reverse()) {
    const original = capture[2],
      timestamp = capture[1];
    if (original === undefined || timestamp === undefined) continue;
    const asset = await fetch(
      `https://web.archive.org/web/${timestamp}id_/${original}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!asset.ok) continue;
    const bytes = new Uint8Array(await asset.arrayBuffer());
    if (imageKind(bytes) !== undefined) return bytes;
  }
  return undefined;
}
async function localBytes(item: Asset): Promise<Uint8Array | undefined> {
  const local = attachmentCandidates.get(item.originalId);
  let bytes =
    local === undefined
      ? undefined
      : new Uint8Array(await Bun.file(local).arrayBuffer());
  // Previously verified repo assets remain available even when archive services are offline.
  const previous =
    corpus.version === 2
      ? corpus.attachments.find((a) => a.originalId === item.originalId)
      : undefined;
  if (bytes === undefined && previous !== undefined) {
    bytes = new Uint8Array(
      await Bun.file(path.join(assetRoot, previous.file)).arrayBuffer(),
    );
    if (hash(bytes) !== previous.sha256)
      throw new Error("Recovered attachment checksum changed");
  }
  return bytes;
}
async function recover(item: Asset): Promise<void> {
  let bytes = await localBytes(item);
  if (bytes === undefined && Bun.argv.includes("--public-archives")) {
    try {
      bytes = await archivedBytes(item.url);
    } catch (error) {
      missing.push({
        url: item.url,
        reason: error instanceof Error ? error.message : "Archive unavailable",
      });
    }
  }
  const extension = bytes === undefined ? undefined : imageKind(bytes);
  if (bytes === undefined || extension === undefined) {
    if (!missing.some((m) => m.url === item.url))
      missing.push({
        url: item.url,
        reason: "No valid public image capture recovered",
      });
    return;
  }
  item.file = `attachment-${String(item.originalId)}.${extension}`;
  item.sha256 = hash(bytes);
  item.filename = item.filename.replace(/\.(png|jpg|gif)$/i, `.${extension}`);
  await Bun.write(path.join(assetRoot, item.file), bytes);
}
const queue = [...attachments.values()];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift())
      await recover(item);
  }),
);
const recoveredIds = new Set(
  [...attachments.values()]
    .filter((a) => a.file !== null)
    .map((a) => a.originalId),
);

function announcementMessage(threadId: number): string {
  const item = news.find((n) => n.thread_id === threadId);
  if (item === undefined)
    throw new Error("Missing reviewed announcement source");
  const edit = edits[String(threadId)];
  let text = item.body;
  if (edit !== undefined) {
    const cut = text.indexOf(edit.cutAt);
    if (cut === -1) throw new Error("Restoration anchor changed");
    text = text.slice(0, cut) + edit.ending;
  }
  const recovered = new Map(images);
  for (const asset of attachments.values())
    if (asset.file !== null) recovered.set(asset.url, asset.file);
  return restoreMessage(text, recovered).replaceAll(
    /\[IMG\]\/data\/storm-history\/attachment-(\d+)\.(?:jpg|png|gif)\[\/IMG\]/g,
    "[ATTACH]$1[/ATTACH]",
  );
}
const threads = corpus.threads.map((thread) => ({
  ...thread,
  posts: thread.posts.map((post) => {
    const userId = names.get(post.author);
    if (userId === undefined)
      throw new Error(
        `Historical author has no original member ID: ${post.author}`,
      );
    const body = bodies.get(post.key)?.body;
    let message =
      body === undefined
        ? post.message
        : archiveBBCode(body, images, recoveredIds);
    if (!sourceThreadIds.has(thread.originalId)) {
      const portal = portalBodies.get(thread.originalId);
      message =
        portal === undefined || thread.reconstructed
          ? announcementMessage(thread.originalId)
          : archiveBBCode(portal, images, recoveredIds);
    }
    const ids =
      rows
        .find((t) => t.thread_id === thread.originalId)
        ?.posts.find(
          (p) =>
            post.key === `${String(thread.originalId)}:${String(p.post_id)}`,
        )
        ?.attachments?.map((a) => Number(/\.(\d+)\//.exec(a.href)?.[1]))
        .filter((assetId) => recoveredIds.has(assetId)) ?? [];
    for (const match of message.matchAll(/\[ATTACH\](\d+)\[\/ATTACH\]/g))
      ids.push(Number(match[1]));
    return {
      ...post,
      originalUserId: userId,
      originalPostId: sourceThreadIds.has(thread.originalId)
        ? Number(post.key.split(":")[1])
        : null,
      previousMessageHash:
        "previousMessageHash" in post
          ? post.previousMessageHash
          : hash(post.message),
      message,
      attachments: [...new Set(ids)],
    };
  }),
}));
const usedUsers = new Set(
  threads.flatMap((t) => t.posts.map((p) => p.originalUserId)),
);
async function recoverAvatar(user: User): Promise<void> {
  for (const size of ["m", "s"]) {
    const base = path.join(
      research,
      `mirror/ts-mc.net/data/avatars/${size}/${String(Math.floor(user.originalId / 1000))}`,
    );
    let filenames: string[];
    try {
      filenames = await readdir(base);
    } catch (error) {
      const result = z.object({ code: z.string() }).safeParse(error);
      if (result.success && result.data.code === "ENOENT") continue;
      throw error;
    }
    const candidates = filenames
      .filter((filename) => filename.startsWith(`${String(user.originalId)}__`))
      .sort();
    const avatar = candidates.at(-1);
    if (avatar === undefined) continue;
    const original = path.join(base, avatar),
      bytes = new Uint8Array(await Bun.file(original).arrayBuffer());
    const extension = imageKind(bytes);
    if (extension !== "jpg" && extension !== "png")
      throw new Error("Invalid cached avatar");
    user.avatar = `avatar-${String(user.originalId)}.${extension}`;
    await cp(original, path.join(assetRoot, user.avatar));
    return;
  }
}
for (const user of users.values())
  if (usedUsers.has(user.originalId)) await recoverAvatar(user);
const enriched = HistorySchema.parse({
  ...corpus,
  version: 2,
  threads,
  users: [...users.values()]
    .filter((u) => usedUsers.has(u.originalId))
    .sort((a, b) => a.originalId - b.originalId),
  attachments: [...attachments.values()]
    .filter(
      (a) =>
        a.file !== null &&
        threads.some((t) =>
          t.posts.some((p) => p.attachments.includes(a.originalId)),
        ),
    )
    .sort((a, b) => a.originalId - b.originalId),
  unavailable: missing.sort((a, b) => a.url.localeCompare(b.url)),
});
await Bun.write(
  path.join(root, "config/history.json"),
  await format(JSON.stringify(enriched), { parser: "json" }),
);
process.stdout.write(
  `Enriched ${String(enriched.threads.length)} threads; ${String(enriched.users.length)} original identities; ${String(enriched.users.filter((u) => u.avatar !== null).length)} avatars; ${String(enriched.attachments.length)} native attachments; ${String(missing.length)} unavailable attachment URLs.\n`,
);
