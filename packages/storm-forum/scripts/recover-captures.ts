import path from "node:path";
import { createHash } from "node:crypto";
import { parseDocument } from "htmlparser2";
import { format } from "prettier";
import { z } from "zod";
import {
  archiveBBCode,
  findAll,
  hasClass,
  textContent,
  type ArchiveElement,
} from "#src/archive-html.ts";
import { HistorySchema, historicalDate } from "#src/history.ts";

const archive = Bun.argv[2],
  recovery = Bun.argv[3];
if (archive === undefined || recovery === undefined)
  throw new Error(
    "Usage: recover-captures.ts <read-only archive> <repo-local recovery directory>",
  );
const destination = path.resolve(import.meta.dirname, "../config/history.json");
const history = HistorySchema.parse(await Bun.file(destination).json());
const research = path.join(archive, "Research");
const rowsText = await Bun.file(
  path.join(research, "analysis/threads.jsonl"),
).text();
const rows = z
  .array(
    z.object({
      thread_id: z.coerce.number(),
      captures: z.array(
        z.object({ file: z.string(), ts: z.string(), wayback: z.url() }),
      ),
    }),
  )
  .parse(
    rowsText
      .trim()
      .split("\n")
      .map((line): unknown => JSON.parse(line)),
  );
const reactions = [
  "like",
  "agree",
  "disagree",
  "funny",
  "winner",
  "informative",
  "useful",
  "optimistic",
  "friendly",
  "creative",
] as const;
function capturedRatings(
  output: ArchiveElement,
): Partial<Record<(typeof reactions)[number], number>> {
  const counts: Partial<Record<(typeof reactions)[number], number>> = {};
  for (const rating of findAll(
    (element) => element.name === "li",
    output.children,
  )) {
    const icon = findAll(
      (element) => element.name === "img",
      rating.children,
    )[0];
    const count = findAll(
      (element) => element.name === "strong",
      rating.children,
    )[0];
    const key = reactions.find(
      (item) => item === icon?.attribs["alt"]?.toLowerCase(),
    );
    if (key === undefined || count === undefined)
      throw new Error("Unknown captured rating type/count");
    const value = Number(textContent(count).trim());
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Invalid captured rating total");
    counts[key] = value;
  }
  return counts;
}
for (const row of rows) {
  const thread = history.threads.find(
    (item) =>
      (item.era ?? "original") === "original" &&
      item.originalId === row.thread_id,
  );
  if (thread === undefined) continue;
  for (const capture of [...row.captures].sort((left, right) =>
    left.ts.localeCompare(right.ts),
  )) {
    const document = parseDocument(
      await Bun.file(path.join(research, capture.file)).text(),
    );
    const source = capture.wayback;
    for (const message of findAll(
      (element) => element.name === "li" && hasClass(element, "message"),
      document.children,
    )) {
      const id = Number(message.attribs["id"]?.replace(/^post-/, ""));
      const post = thread.posts.find((item) => item.originalPostId === id);
      if (post === undefined) continue;
      const output = findAll(
        (element) => hasClass(element, "dark_postrating_outputlist"),
        message.children,
      )[0];
      if (output === undefined) continue;
      const counts = capturedRatings(output);
      if (Object.keys(counts).length > 0)
        post.ratings = { captured: capture.ts, source, counts };
    }
    const question = findAll(
      (element) => hasClass(element, "questionText"),
      document.children,
    )[0];
    const results = findAll(
      (element) => element.name === "li" && hasClass(element, "pollResult"),
      document.children,
    );
    const hiddenResults =
      findAll(
        (element) =>
          hasClass(element, "pollResults") && hasClass(element, "noResults"),
        document.children,
      ).length > 0;
    if (!hiddenResults && question !== undefined && results.length >= 2) {
      const options = results.map((result) => {
        const text = findAll(
          (element) => hasClass(element, "optionText"),
          result.children,
        )[0];
        const count = findAll(
          (element) => hasClass(element, "count"),
          result.children,
        )[0];
        const votes =
          count === undefined
            ? undefined
            : /^(\d+)\s+vote/.exec(textContent(count).trim())?.[1];
        if (text === undefined || votes === undefined)
          throw new Error(
            `Incomplete captured poll result: ${capture.file}: ${count === undefined ? "missing" : textContent(count).trim()}`,
          );
        return { text: textContent(text).trim(), votes: Number(votes) };
      });
      thread.poll = {
        question: textContent(question).trim(),
        options,
        captured: capture.ts,
        source,
      };
    }
  }
}
const hash = (message: string) =>
  createHash("sha256").update(message).digest("hex");
function addRevival(record: {
  era: "revival2016" | "revival2022";
  id: number;
  title: string;
  slug: string;
  date: number;
  message: string;
  captured: string;
  sources: string[];
  postId: number | null;
}): void {
  const { era, id, title, slug, date, message, captured, sources, postId } =
    record;
  if (!history.users.some((user) => user.era === era && user.originalId === 1))
    history.users.push({
      era,
      originalId: 1,
      canonicalOriginalId: 1,
      username: "RiotShielder",
      aliases: ["RiotShielder"],
      slugs: ["riotshielder"],
      captured,
      avatar: null,
    });
  const existing = history.threads.find(
    (thread) => thread.era === era && thread.originalId === id,
  );
  if (existing !== undefined) {
    existing.sources = sources;
    return;
  }
  history.threads.push({
    era,
    originalId: id,
    title,
    slug,
    node: era === "revival2016" ? "news" : "general",
    reconstructed: false,
    sources,
    posts: [
      {
        key: `${String(id)}:${String(postId ?? 1)}`,
        originalUserId: 1,
        originalPostId: postId,
        author: "RiotShielder",
        date,
        message,
        previousMessageHash: hash(message),
        attachments: [],
      },
    ],
  });
}
const july = parseDocument(
  await Bun.file(
    path.join(
      research,
      "mirror-cc/ts-mc.net/index__https_20161022232757_200.html",
    ),
  ).text(),
);
const article = findAll(
  (element) => hasClass(element, "recentNews") && element.attribs["id"] === "9",
  july.children,
)[0];
const body =
  article === undefined
    ? undefined
    : findAll((element) => hasClass(element, "newsText"), article.children)[0];
if (body === undefined) throw new Error("Missing captured 2016 announcement");
addRevival({
  era: "revival2016",
  id: 9,
  title: "What's been happening?",
  slug: "whats-been-happening",
  date: historicalDate(null, "Jul 27, 2016 at 3:47 PM"),
  message: archiveBBCode(body, new Map(), new Set()),
  captured: "20161022232757",
  sources: ["https://web.archive.org/web/20161022232757id_/https://ts-mc.net/"],
  postId: null,
});
const capture2022 = "20221120082813";
const document2022 = parseDocument(
  await Bun.file(path.join(recovery, `forum-2022-${capture2022}.html`)).text(),
);
const post2022 = findAll(
  (element) =>
    element.name === "article" && element.attribs["data-content"] === "post-1",
  document2022.children,
)[0];
const body2022 =
  post2022 === undefined
    ? undefined
    : findAll(
        (element) => hasClass(element, "bbWrapper"),
        post2022.children,
      )[0];
const date2022 =
  post2022 === undefined
    ? undefined
    : findAll(
        (element) =>
          element.name === "time" &&
          element.attribs["itemprop"] === "datePublished",
        post2022.children,
      )[0];
if (
  body2022 === undefined ||
  date2022 === undefined ||
  post2022?.attribs["data-author"] !== "RiotShielder"
)
  throw new Error("Missing corroborated 2022 post");
addRevival({
  era: "revival2022",
  id: 1,
  title: "My First Thread",
  slug: "my-first-thread",
  date: Number(date2022.attribs["data-time"]),
  message: archiveBBCode(body2022, new Map(), new Set()),
  captured: capture2022,
  sources: ["20221120082813", "20221120085515"].map(
    (timestamp) =>
      `https://web.archive.org/web/${timestamp}id_/https://forum.ts-mc.net/threads/my-first-thread.1/`,
  ),
  postId: 1,
});
history.version = 3;
const validated = HistorySchema.parse(history);
await Bun.write(
  destination,
  await format(JSON.stringify(validated), { parser: "json" }),
);
process.stdout.write(
  `${String(validated.threads.length)} discussions, ${String(validated.threads.reduce((total, thread) => total + thread.posts.length, 0))} posts; ${String(validated.threads.filter((thread) => thread.poll !== undefined).length)} captured polls, ${String(validated.threads.flatMap((thread) => thread.posts).filter((post) => post.ratings !== undefined).length)} captured rating summaries.\n`,
);
