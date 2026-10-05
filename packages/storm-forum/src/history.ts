import { z } from "zod";

const HistoricalPostSchema = z
  .object({
    key: z.string().regex(/^\d+:\d+$/),
    author: z.string().min(1).max(50),
    date: z.number().int().positive(),
    message: z.string().min(1).max(100_000),
  })
  .strict();
export const HistorySchema = z
  .object({
    version: z.literal(1),
    threads: z.array(
      z
        .object({
          originalId: z.number().int().positive(),
          slug: z.string().min(1),
          title: z.string().min(1).max(150),
          node: z.enum(["news", "general", "feedback", "bugs", "games"]),
          reconstructed: z.boolean(),
          sources: z.array(z.url()).min(1),
          posts: z.array(HistoricalPostSchema).min(1),
        })
        .strict(),
    ),
    omitted: z.array(
      z
        .object({ originalId: z.number().int().positive(), reason: z.string() })
        .strict(),
    ),
  })
  .strict()
  .superRefine((history, ctx) => {
    const threads = new Set<number>(),
      posts = new Set<string>();
    for (const thread of history.threads) {
      if (threads.has(thread.originalId))
        ctx.addIssue({
          code: "custom",
          message: "Duplicate historical thread",
        });
      threads.add(thread.originalId);
      for (const post of thread.posts) {
        if (posts.has(post.key))
          ctx.addIssue({
            code: "custom",
            message: "Duplicate historical post",
          });
        posts.add(post.key);
      }
    }
  });

// ISO timestamps in the captures are exact. Board-local dates used Mountain time.
export function historicalDate(iso: string | null, text: string): number {
  if (iso?.endsWith("Z") === true) {
    const value = Date.parse(iso);
    if (!Number.isFinite(value)) throw new Error("Invalid historical ISO date");
    return Math.floor(value / 1000);
  }
  const match =
    /^(\w{3}) (\d{1,2}), (\d{4}) at (\d{1,2}):(\d{2}) (AM|PM)$/.exec(text);
  if (!match)
    throw new Error(`Historical date needs a corroborated timestamp: ${text}`);
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ].indexOf(match[1] ?? "");
  if (month === -1) throw new Error("Invalid historical month");
  const hour = (Number(match[4]) % 12) + (match[6] === "PM" ? 12 : 0);
  const target = Date.UTC(
    Number(match[3]),
    month,
    Number(match[2]),
    hour,
    Number(match[5]),
  );
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
  let value = target;
  for (let index = 0; index < 2; index++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(value).map((part) => [part.type, part.value]),
    );
    const local = Date.UTC(
      Number(parts["year"]),
      Number(parts["month"]) - 1,
      Number(parts["day"]),
      Number(parts["hour"]),
      Number(parts["minute"]),
      Number(parts["second"]),
    );
    value += target - local;
  }
  return Math.floor(value / 1000);
}

export function restoreMessage(
  text: string,
  images: Map<string, string>,
): string {
  return text
    .replaceAll(/\[img ([^\]]+)\]/gi, (_, url: string) => {
      const path = images.get(url.replace(/^http:/, "https:"));
      return path === undefined ? "" : `[IMG]/data/storm-history/${path}[/IMG]`;
    })
    .replaceAll(
      /\[quote=([^\]]+)\]/gi,
      (_, name: string) => `[QUOTE="${name.replaceAll(/["\r\n]/g, "")}"]`,
    )
    .trim();
}
