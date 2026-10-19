import { Resvg } from "@resvg/resvg-js";
import { renderCard } from "#src/render.ts";

const root = new URL("../assets/", import.meta.url);
const check = Bun.argv.includes("--check");
for (const [source, name, width] of [
  ["brand/mark.svg", "brand/icon-64.png", 64],
  ["brand/mark.svg", "brand/icon-180.png", 180],
  ["brand/mark.svg", "brand/icon-192.png", 192],
  ["brand/mark.svg", "brand/icon-512.png", 512],
  ["brand/favicon.svg", "brand/favicon-48.png", 48],
  ["brand/favicon.svg", "brand/favicon-32.png", 32],
  ["logo.svg", "brand/wordmark.png", 1300],
] as const) {
  const png = new Resvg(await Bun.file(new URL(source, root)).text(), {
    fitTo: { mode: "width", value: width },
  })
    .render()
    .asPng();
  const destination = Bun.file(new URL(name, root));
  if (check) {
    if (!Buffer.from(await destination.bytes()).equals(png)) {
      throw new Error(`Run storm-theme generate: ${name} differs`);
    }
  } else {
    await Bun.write(destination, png);
  }
}
const revision = new Bun.CryptoHasher("sha256");
revision.update(await Bun.file(new URL("../catalog.json", root)).bytes());
for (const [name, card] of [
  [
    "social.png",
    {
      theme: "normal",
      section: "Survival · Towns · Quests",
      title: "Build a town. Brave The Storm.",
      description: "Minecraft Java + Bedrock · ts-mc.net",
    },
  ],
  [
    "livemap-social.png",
    {
      theme: "normal",
      section: "The Storm LiveMap",
      title: "Explore The Storm",
      description: "Discover the world and find your next home. ts-mc.net",
    },
  ],
] as const) {
  const png = await renderCard(card);
  revision.update(png);
  const destination = Bun.file(new URL(`brand/${name}`, root));
  if (check) {
    if (!Buffer.from(await destination.bytes()).equals(Buffer.from(png))) {
      throw new Error(`Run storm-theme generate: ${name} differs`);
    }
  } else {
    await Bun.write(destination, png);
  }
}
const revisionFile = Bun.file(new URL("brand/revision.txt", root));
const digest = revision.digest("hex").slice(0, 12) + "\n";
if (check) {
  if ((await revisionFile.text()) !== digest) {
    throw new Error("Run storm-theme generate: brand revision differs");
  }
} else {
  await Bun.write(revisionFile, digest);
}
process.stdout.write("Original Storm brand renditions verified.\n");
