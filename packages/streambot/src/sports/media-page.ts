import { z } from "zod";
import { capturedHeaders } from "./pinchtab-player.ts";
import { SportsPlaybackError } from "./failures.ts";

type Client = {
  readonly open: (
    url: string,
    signal: AbortSignal,
  ) => Promise<{ tabId: string }>;
  readonly json: (path: string, signal: AbortSignal) => Promise<unknown>;
  readonly close: (tab: string) => Promise<void>;
};
const PageSchema = z.object({ html: z.string() });
const CaptureSchema = z.object({
  entries: z.array(
    z.object({
      url: z.string(),
      status: z.number().optional(),
      requestHeaders: z.record(z.string(), z.string()).optional(),
    }),
  ),
});

/** Free media tickets must use the User-Agent which obtained their document. */
export async function readSportsMediaPage(
  url: string,
  signal: AbortSignal,
  client: Client,
) {
  signal.throwIfAborted();
  const { tabId } = await client.open(url, signal);
  const path = `/tabs/${encodeURIComponent(tabId)}`;
  try {
    const page = PageSchema.parse(await client.json(path + "/html", signal));
    const capture = CaptureSchema.parse(
      await client.json(path + "/network?limit=150", signal),
    );
    const document = capture.entries.find(
      (entry) => entry.url === url && entry.status === 200,
    );
    if (document === undefined) throw new SportsPlaybackError("unavailable");
    const headers = capturedHeaders(document, url);
    if (headers["User-Agent"] === undefined)
      throw new Error("Sports media User-Agent is missing");
    return { html: page.html, headers };
  } finally {
    await client.close(tabId);
  }
}
