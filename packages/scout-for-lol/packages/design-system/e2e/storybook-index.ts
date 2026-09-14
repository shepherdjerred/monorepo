import { z } from "zod";

const StorybookEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  name: z.string(),
  type: z.string(),
});

const StorybookIndexSchema = z.object({
  v: z.number(),
  entries: z.record(z.string(), StorybookEntrySchema),
});

export type StorybookEntry = z.infer<typeof StorybookEntrySchema>;

/**
 * Reads the story index from the built catalog. Playwright collects spec files
 * before it starts the web server, so the index comes off disk rather than over
 * HTTP. `test:e2e` depends on `build`; run
 * `turbo run build --filter=@scout-for-lol/design-system` first when invoking
 * Playwright directly.
 */
export async function loadStorybookStories(): Promise<StorybookEntry[]> {
  const indexPath = new URL("../storybook-static/index.json", import.meta.url);
  const index = StorybookIndexSchema.parse(await Bun.file(indexPath).json());
  return Object.values(index.entries).filter((entry) => entry.type === "story");
}
