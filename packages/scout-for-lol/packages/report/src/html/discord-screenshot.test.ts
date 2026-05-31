import { afterAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { discordScreenshotToImage } from "#src/html/discord-screenshot.tsx";

const FIXTURE_PNG_BYTES: Uint8Array = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR4nGP8z8Dwn4GBgYERiIEMVAEAFf4CAyHVhA4AAAAASUVORK5CYII=",
  "base64",
);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const OUTPUT_DIR = path.resolve(
  import.meta.dir,
  "..",
  "..",
  "test-output",
  "discord-screenshot",
);
const writtenFiles: string[] = [];

await mkdir(OUTPUT_DIR, { recursive: true });

afterAll(() => {
  console.log("");
  console.log("=== RENDERED DISCORD SCREENSHOT FIXTURES ===");
  for (const file of writtenFiles) {
    console.log(file);
  }
});

function expectPng(image: Uint8Array): void {
  expect(image.length).toBeGreaterThan(1000);
  expect(image.slice(0, PNG_SIGNATURE.length)).toEqual(
    Uint8Array.from(PNG_SIGNATURE),
  );
}

describe("discord screenshot renderer", () => {
  test("renders a PNG from a fixture PNG", async () => {
    const image = await discordScreenshotToImage({
      embeddedImageBytes: FIXTURE_PNG_BYTES,
      timestamp: "5:23 AM",
      appName: "Scout for LoL",
    });

    expectPng(image);
  });

  test("renders chat messages before and after the embed", async () => {
    const image = await discordScreenshotToImage({
      embeddedImageBytes: await Bun.file(
        path.resolve(
          import.meta.dir,
          "ranked",
          "assets",
          "Rank=Challenger.png",
        ),
      ).bytes(),
      timestamp: "5:23 AM",
      appName: "Scout for LoL",
      appNameColor: "#ff5a1f",
      botMessage: "dropped a ranked solo recap",
      botAvatarText: "S",
      botAvatarColor: "#1f2937",
      embedImageWidth: 360,
      chatMessagesBeforeEmbed: [
        {
          timestamp: "5:21 AM",
          author: "rangedtop",
          authorColor: "#23a559",
          avatarText: "R",
          avatarColor: "#23a559",
          content: "queue one more?",
        },
        {
          timestamp: "5:22 AM",
          author: "mid diff",
          authorColor: "#f0b232",
          avatarText: "M",
          avatarColor: "#f0b232",
          content: "send the recap first",
        },
      ],
      chatMessagesAfterEmbed: [
        {
          timestamp: "5:24 AM",
          author: "Jerred",
          authorColor: "#ffd400",
          avatarText: "J",
          avatarColor: "#475569",
          content: "we take those",
        },
        {
          author: "Jerred",
          authorColor: "#ffd400",
          avatarText: "J",
          avatarColor: "#475569",
          content: "damage chart checks out",
        },
      ],
    });
    const outPath = path.join(OUTPUT_DIR, "chat-messages.png");
    await Bun.write(outPath, image);
    writtenFiles.push(outPath);

    expectPng(image);
  });

  test("rejects non-PNG embedded image bytes", async () => {
    await expect(
      discordScreenshotToImage({
        embeddedImageBytes: Uint8Array.from([1, 2, 3, 4]),
      }),
    ).rejects.toThrow("Discord screenshot renderer only supports PNG input");
  });
});
