import { z } from "zod/v4";
/** Machine-readable approved variants; the agent selects one without rewriting it. */
export async function approvedDiscordCopy(): Promise<string[]> {
  const root = new URL(
    "copy/",
    import.meta.resolve("@shepherdjerred/the-storm/promotion/targets.json"),
  );
  const fullText = await Bun.file(
    new URL("directory-description.txt", root),
  ).text();
  const shortText = await Bun.file(
    new URL("short-descriptions.txt", root),
  ).text();
  const full = fullText.trim();
  const short = shortText
    .trim()
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").slice(1).join("\n").trim());
  if (full === "" || short.includes(""))
    throw new Error("Approved copy is empty");
  return [full, ...short];
}

export async function assertDiscordPayload(
  tool: { endpoint: string; body?: unknown },
  variants: Promise<string[]>,
) {
  if (tool.endpoint !== "discord-send") return;
  const { content } = z.object({ content: z.string() }).parse(tool.body);
  const approved = await variants;
  if (!approved.includes(content))
    throw new Error(
      "Payload must exactly match an approved-messages.json variant; serialize it with JSON.stringify",
    );
}
