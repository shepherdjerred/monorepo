import path from "node:path";
import { buildWorldRecords } from "./knowledge/archipelago.ts";
import { buildBulbapediaRecords } from "./knowledge/bulbapedia.ts";
import { KnowledgeRecordsSchema, SourcesSchema } from "./knowledge/model.ts";
import { buildPokeApiRecords } from "./knowledge/pokeapi.ts";

const packageRoot = path.resolve(import.meta.dir, "..");
const sourcesPath = path.join(packageRoot, "knowledge", "sources.json");
const sources = SourcesSchema.parse(await Bun.file(sourcesPath).json());

const [world, pokeapi, bulbapedia] = await Promise.all([
  buildWorldRecords(sources),
  buildPokeApiRecords(sources),
  buildBulbapediaRecords(sources),
]);

const sortRecords = (left: { id: string }, right: { id: string }): number =>
  left.id.localeCompare(right.id);
const permissive = KnowledgeRecordsSchema.parse(
  [...world, ...pokeapi].sort(sortRecords),
);
const shareAlike = KnowledgeRecordsSchema.parse(bulbapedia.sort(sortRecords));
const allIds = new Set(
  [...permissive, ...shareAlike].map((record) => record.id),
);
if (allIds.size !== permissive.length + shareAlike.length) {
  throw new Error("knowledge record IDs must be globally unique");
}

const generatedDirectory = path.join(packageRoot, "knowledge", "generated");
const shareAlikeDirectory = path.join(
  packageRoot,
  "knowledge",
  "cc-by-nc-sa-2.5",
);
const generatedPath = path.join(generatedDirectory, "records.json");
const walkthroughPath = path.join(shareAlikeDirectory, "walkthrough.json");
await Promise.all([
  Bun.write(generatedPath, `${JSON.stringify(permissive, undefined, 2)}\n`, {
    createPath: true,
  }),
  Bun.write(walkthroughPath, `${JSON.stringify(shareAlike, undefined, 2)}\n`, {
    createPath: true,
  }),
]);

const prettier = Bun.spawn(
  ["bunx", "prettier", "--write", generatedPath, walkthroughPath],
  {
    stdout: "inherit",
    stderr: "inherit",
  },
);
const prettierExit = await prettier.exited;
if (prettierExit !== 0) {
  throw new Error(`prettier exited with code ${String(prettierExit)}`);
}

console.log(
  `wrote ${String(permissive.length)} permissive and ${String(shareAlike.length)} CC BY-NC-SA knowledge records`,
);
