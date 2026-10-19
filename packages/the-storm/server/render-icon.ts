import { Resvg } from "@resvg/resvg-js";

// The original cloud-backed TS mark is shared by all Storm applications.
const source = new URL(
  "../../storm-theme/assets/brand/mark.svg",
  import.meta.url,
);
const destination = new URL("assets/server-icon.png", import.meta.url);
const rendered = new Resvg(await Bun.file(source).text(), {
  fitTo: { mode: "width", value: 64 },
}).render();
if (rendered.width !== 64 || rendered.height !== 64) {
  throw new Error("The multiplayer server icon must be 64×64");
}
const png = rendered.asPng();
if (Bun.argv.includes("--check")) {
  const installed = new Uint8Array(await Bun.file(destination).arrayBuffer());
  if (
    installed.length !== png.length ||
    installed.some((byte, i) => byte !== png[i])
  ) {
    throw new Error("The server icon is stale; run bun run icon:render");
  }
} else {
  await Bun.write(destination, png);
}
process.stdout.write("The Storm multiplayer icon: 64×64 PNG verified.\n");
