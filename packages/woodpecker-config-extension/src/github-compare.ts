import type { FetchLike } from "#src/http.ts";
import { z } from "zod";

const CompareSchema = z.object({
  status: z.string(),
  merge_base_commit: z.object({ sha: z.string() }),
  files: z.array(z.object({ filename: z.string() })),
});

/**
 * Woodpecker's push payload contains only this push's files. Compare from the
 * last wholly successful main pipeline so changes from a failed release stay
 * selected on a later push. Any uncertain comparison selects the full graph.
 */
export async function changedFilesSince(
  repository: string,
  base: string,
  head: string,
  fetchImpl: FetchLike = fetch,
): Promise<string[] | undefined> {
  if (!/^[a-f0-9]{40}$/u.test(base) || !/^[a-f0-9]{40}$/u.test(head)) {
    return undefined;
  }
  const url = new URL(
    `https://api.github.com/repos/${repository}/compare/${base}...${head}`,
  );
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) return undefined;
    const compared = CompareSchema.safeParse(await response.json());
    if (!compared.success) return undefined;
    return compared.data.merge_base_commit.sha !== base ||
      !["ahead", "identical"].includes(compared.data.status) ||
      compared.data.files.length >= 300
      ? undefined
      : compared.data.files.map((file) => file.filename);
  } catch {
    return undefined;
  }
}
