import { z } from "zod";

const HistoricalPostSchema = z
  .object({
    key: z.string().regex(/^\d+:\d+$/),
    author: z.string().min(1).max(50),
    date: z.number().int().positive(),
    message: z.string().min(1).max(100_000),
  })
  .strict();
export const LegacyHistorySchema = z
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

const UserSchema = z
  .object({
    originalId: z.number().int().positive(),
    username: z.string().min(1).max(50),
    aliases: z.array(z.string().min(1)),
    slugs: z.array(z.string().min(1)),
    captured: z.string().regex(/^\d{14}$/),
    avatar: z
      .string()
      .regex(/^avatar-\d+\.(jpg|png)$/)
      .nullable(),
  })
  .strict();
export const HistorySchema = z
  .object({
    ...LegacyHistorySchema.shape,
    version: z.literal(2),
    users: z.array(UserSchema),
    attachments: z.array(
      z
        .object({
          originalId: z.number().int().positive(),
          url: z.url(),
          filename: z.string().min(1),
          file: z.string().regex(/^attachment-\d+\.(jpg|png|gif)$/),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    ),
    unavailable: z.array(
      z.object({ url: z.url(), reason: z.string().min(1) }).strict(),
    ),
    threads: z.array(
      LegacyHistorySchema.shape.threads.element.extend({
        posts: z
          .array(
            HistoricalPostSchema.extend({
              originalUserId: z.number().int().positive(),
              originalPostId: z.number().int().positive().nullable(),
              previousMessageHash: z.string().regex(/^[a-f0-9]{64}$/),
              attachments: z.array(z.number().int().positive()),
            }),
          )
          .min(1),
      }),
    ),
  })
  .strict()
  .superRefine((history, ctx) => {
    const threadIds = new Set(history.threads.map((t) => t.originalId)),
      postIds = history.threads.flatMap((t) => t.posts.map((p) => p.key));
    if (
      threadIds.size !== history.threads.length ||
      new Set(postIds).size !== postIds.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate historical thread or post",
      });
    const users = new Set(history.users.map((u) => u.originalId)),
      attachments = new Set(history.attachments.map((a) => a.originalId));
    const ownedAttachments = history.threads.flatMap((thread) =>
      thread.posts.flatMap((post) => post.attachments),
    );
    if (new Set(ownedAttachments).size !== ownedAttachments.length)
      ctx.addIssue({
        code: "custom",
        message: "Duplicate historical attachment ownership",
      });
    if (
      users.size !== history.users.length ||
      attachments.size !== history.attachments.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate historical identity or attachment",
      });
    for (const thread of history.threads) {
      const originalPosts = thread.posts.flatMap((post) =>
        post.originalPostId === null ? [] : [post.originalPostId],
      );
      if (new Set(originalPosts).size !== originalPosts.length)
        ctx.addIssue({
          code: "custom",
          message: "Duplicate original post within a historical thread",
        });
      for (const post of thread.posts) {
        if (
          !users.has(post.originalUserId) ||
          post.attachments.some((id) => !attachments.has(id))
        )
          ctx.addIssue({
            code: "custom",
            message: "Historical post has an unresolved identity or attachment",
          });
      }
    }
  });

// ISO timestamps in the captures are exact. Board-local dates used Mountain time.
export function historicalDate(iso: string | null, text: string): number {
  if (iso?.endsWith("Z") === true) {
    const value = Date.parse(iso);
    if (!Number.isFinite(value))
      throw new TypeError("Invalid historical ISO date");
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
