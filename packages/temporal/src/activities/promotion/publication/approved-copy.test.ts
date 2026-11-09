import { expect, it } from "vitest";
import { assertDiscordPayload } from "./approved-copy.ts";

it("preserves approved apostrophes, newlines and shell metacharacters before dispatch", async () => {
  const content = "A town's $HOME; $(whoami) `literal`\nsecond line";
  const encoded = JSON.stringify({ content });
  const body: unknown = JSON.parse(encoded);
  await expect(
    assertDiscordPayload(
      { endpoint: "discord-send", body },
      Promise.resolve([content]),
    ),
  ).resolves.toBeUndefined();
  await expect(
    assertDiscordPayload(
      {
        endpoint: "discord-send",
        body: { content: content.replace("town's", "towns") },
      },
      Promise.resolve([content]),
    ),
  ).rejects.toThrow("exactly match");
});
