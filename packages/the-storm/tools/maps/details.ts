import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { MapContent } from "#learning/maps/scenario.ts";
import { freezeInputs } from "./inputs.ts";
import { root } from "./paper.ts";
import { exportDetails } from "./details-paper.ts";

const args = parseArgs({
  strict: true,
  options: {
    import: { type: "string", multiple: true },
    output: { type: "string" },
    map: { type: "string", multiple: true },
  },
});
const imports = z
  .array(z.string().min(1))
  .min(1)
  .parse(args.values.import)
  .map((p) => path.resolve(p));
const output = path.resolve(z.string().min(1).parse(args.values.output));
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { mode: 0o700 });
const build = Bun.spawn(
  [
    "mise",
    "exec",
    "--",
    "gradle",
    "-p",
    "plugin",
    ":dist:assemble",
    ":rwfmap:installDist",
    "--console=plain",
  ],
  {
    cwd: root,
    stdout: Bun.file(path.join(output, "build.log")),
    stderr: "inherit",
  },
);
if ((await build.exited) !== 0)
  throw new Error("Map details producer build failed");
const inputs = await freezeInputs(root, output);
const sources = new Map<string, string>();
for (const imported of imports)
  for (const entry of await readdir(imported, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = path.join(imported, entry.name);
    if (
      !(await Bun.file(
        path.join(source, "content", entry.name, "source.json"),
      ).exists())
    )
      continue;
    if (sources.has(entry.name))
      throw new Error(`Duplicate converted world: ${entry.name}`);
    sources.set(entry.name, source);
  }
for (const id of args.values.map ?? [])
  if (!sources.has(id)) throw new Error(`Missing converted map: ${id}`);
const queue = [...sources].filter(
  ([id]) => args.values.map === undefined || args.values.map.includes(id),
);
const results: {
  id: string;
  status: string;
  containers?: number;
  signs?: number;
  reason?: string;
}[] = [];
const Metadata = z.object({
  source: z.object({
    Border: z
      .array(z.tuple([z.number().int(), z.number().int(), z.number().int()]))
      .length(2),
  }),
});
async function worker() {
  for (;;) {
    const entry = queue.shift();
    if (entry === undefined) return;
    const [id, source] = entry;
    const target = path.join(output, id);
    await mkdir(target);
    try {
      await inputs.check();
      const folder = path.join(source, "content", id);
      const map = MapContent.parse(
        Bun.YAML.parse(await Bun.file(path.join(folder, "map.yml")).text()),
      );
      const metadata = Metadata.parse(
        await Bun.file(path.join(folder, "source.json")).json(),
      );
      const min = {
        x: Math.min(...metadata.source.Border.map((p) => p[0])),
        z: Math.min(...metadata.source.Border.map((p) => p[2])),
      };
      console.warn(`Preserving native inventories/signs: ${id}`);
      const result = await exportDetails(
        source,
        target,
        { map, originalMin: min },
        inputs,
      );
      await inputs.check();
      const file = Bun.file(path.join(target, "details.json"));
      const sha256 = new Bun.CryptoHasher("sha256")
        .update(await file.arrayBuffer())
        .digest("hex");
      await Bun.write(
        path.join(target, "provenance.json"),
        JSON.stringify(
          {
            schema: 1,
            id,
            blocksSha256: map.blocksSha256,
            detailsSha256: sha256,
            policy:
              "preserve-inventories-and-literal-sign-text-strip-other-payloads",
            producer: inputs.hashes,
            result,
          },
          null,
          2,
        ) + "\n",
      );
      results.push({
        id,
        status: "exported-awaiting-runtime-acceptance",
        containers: result.containers,
        signs: result.signs,
      });
    } catch (error) {
      results.push({
        id,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    await Bun.write(
      path.join(output, "results.json"),
      JSON.stringify(results, null, 2) + "\n",
    );
  }
}
// The E2E harness owns one staging directory per process; keep Paper owners sequential.
await worker();
await Bun.write(
  path.join(output, "results.json"),
  JSON.stringify(
    results.toSorted((a, b) => a.id.localeCompare(b.id)),
    null,
    2,
  ) + "\n",
);
if (results.some((r) => r.status === "failed"))
  throw new Error("Native map details export incomplete; see results.json");
