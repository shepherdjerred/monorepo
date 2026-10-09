import { expect, test } from "vitest";
import satori, { type SatoriNode } from "satori";
import { scoutOgCard } from "./og-card.ts";

test("the social card keeps its title and description inside the padded canvas", async () => {
  const title = "Scout for League of Legends";
  const description =
    "Get notified when your friends start matches and get post-match reports in Discord.";
  const fonts = new URL("../../assets/fonts/", import.meta.url);
  const nodes: SatoriNode[] = [];
  await satori(scoutOgCard({ title, description }), {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: "Beaufort for LoL",
        weight: 700,
        data: await Bun.file(
          new URL("BeaufortForLoL-TTF/BeaufortforLOL-Bold.ttf", fonts),
        ).arrayBuffer(),
      },
      {
        name: "Spiegel",
        weight: 400,
        data: await Bun.file(
          new URL("Spiegel-TTF/Spiegel_TT_Regular.ttf", fonts),
        ).arrayBuffer(),
      },
      {
        name: "Spiegel",
        weight: 600,
        data: await Bun.file(
          new URL("Spiegel-TTF/Spiegel_TT_SemiBold.ttf", fonts),
        ).arrayBuffer(),
      },
    ],
    onNodeDetected: (node) => nodes.push(node),
  });

  const titleNode = nodes.find((node) => node.textContent === title);
  const descriptionNode = nodes.find(
    (node) => node.textContent === description,
  );
  expect(titleNode).toBeDefined();
  expect(descriptionNode).toBeDefined();
  if (titleNode === undefined || descriptionNode === undefined) {
    throw new Error("Social card text was not rendered");
  }
  expect(titleNode.top + titleNode.height).toBeLessThan(descriptionNode.top);
  for (const node of [titleNode, descriptionNode]) {
    expect(node.left).toBeGreaterThanOrEqual(80);
    expect(node.left + node.width).toBeLessThanOrEqual(1120);
    expect(node.top + node.height).toBeLessThanOrEqual(550);
  }
});
