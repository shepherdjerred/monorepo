import { z } from "zod/v4";

const BASE_URL = "https://hacker-news.firebaseio.com/v0";

const HNUserSchema = z.object({
  id: z.string(),
  created: z.number(),
  karma: z.number(),
  about: z.string().optional(),
  submitted: z.array(z.number()).optional(),
});

const HNItemSchema = z.object({
  id: z.number(),
  type: z.enum(["story", "comment", "job", "poll", "pollopt"]),
  by: z.string().optional(),
  time: z.number().optional(),
  text: z.string().optional(),
  parent: z.number().optional(),
  kids: z.array(z.number()).optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  score: z.number().optional(),
  descendants: z.number().optional(),
});

export type HNUser = z.infer<typeof HNUserSchema>;
export type HNItem = z.infer<typeof HNItemSchema>;

export async function fetchUser(username: string): Promise<HNUser | undefined> {
  const response = await fetch(`${BASE_URL}/user/${encodeURIComponent(username)}.json`);
  if (!response.ok) return undefined;
  const json: unknown = await response.json();
  const parsed = HNUserSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  return undefined;
}

export async function fetchItem(id: number): Promise<HNItem | undefined> {
  const response = await fetch(`${BASE_URL}/item/${String(id)}.json`);
  if (!response.ok) return undefined;
  const json: unknown = await response.json();
  const parsed = HNItemSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  return undefined;
}

export async function fetchUserAccountAge(username: string): Promise<number | undefined> {
  const user = await fetchUser(username);
  if (!user) return undefined;
  return user.created;
}

export function isNewAccount(createdTimestamp: number, maxAgeDays: number): boolean {
  const ageSeconds = Date.now() / 1000 - createdTimestamp;
  return ageSeconds < maxAgeDays * 24 * 60 * 60;
}

export async function fetchItemsInBatches(
  ids: number[],
  batchSize = 5,
): Promise<(HNItem | undefined)[]> {
  const results: (HNItem | undefined)[] = [];

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((id) => fetchItem(id)));
    results.push(...batchResults);
  }

  return results;
}
