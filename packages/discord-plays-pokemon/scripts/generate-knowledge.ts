import path from "node:path";
import { parsePokemonUpstream } from "./lib/upstream.ts";
import { buildWorldRecords } from "./knowledge/archipelago.ts";
import { buildBulbapediaRecords } from "./knowledge/bulbapedia.ts";
import { KnowledgeRecordsSchema, SourcesSchema } from "./knowledge/model.ts";
import { buildPokeApiRecords } from "./knowledge/pokeapi.ts";
import {
  buildPokeemeraldRecords,
  createPokeemeraldFileKnowledgeSource,
  createPokeemeraldKnowledgeSource,
  HIDDEN_POWER_SOURCE_PATH,
} from "./knowledge/pokeemerald.ts";

const packageRoot = path.resolve(import.meta.dir, "..");
const sourcesPath = path.join(packageRoot, "knowledge", "sources.json");
const sources = SourcesSchema.parse(await Bun.file(sourcesPath).json());
const pokeemeraldManifestPath = path.resolve(
  path.dirname(sourcesPath),
  sources.pokeemeraldWasm.manifest,
);
const pokeemeraldUpstream = parsePokemonUpstream(
  await Bun.file(pokeemeraldManifestPath).json(),
);
const pokeemeraldKnowledgeSource = createPokeemeraldKnowledgeSource(
  sources.pokeemeraldWasm.license,
  pokeemeraldUpstream.repository,
  pokeemeraldUpstream.commit,
);
const hiddenPowerMechanicSource = createPokeemeraldFileKnowledgeSource(
  sources.pokeemeraldWasm.license,
  pokeemeraldUpstream.repository,
  pokeemeraldUpstream.commit,
  HIDDEN_POWER_SOURCE_PATH,
);

const [world, pokeapi, pokeemerald, bulbapedia] = await Promise.all([
  buildWorldRecords(sources),
  buildPokeApiRecords(
    sources,
    pokeemeraldKnowledgeSource,
    hiddenPowerMechanicSource,
  ),
  buildPokeemeraldRecords(
    sources.pokeemeraldWasm.license,
    pokeemeraldUpstream.repository,
    pokeemeraldUpstream.commit,
  ),
  buildBulbapediaRecords(sources),
]);

const sortRecords = (left: { id: string }, right: { id: string }): number =>
  left.id.localeCompare(right.id);
const generated = KnowledgeRecordsSchema.parse(
  [...world, ...pokeapi, ...pokeemerald].sort(sortRecords),
);
const shareAlike = KnowledgeRecordsSchema.parse(bulbapedia.sort(sortRecords));
const allIds = new Set(
  [...generated, ...shareAlike].map((record) => record.id),
);
if (allIds.size !== generated.length + shareAlike.length) {
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
  Bun.write(generatedPath, `${JSON.stringify(generated, undefined, 2)}\n`, {
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
  `wrote ${String(generated.length)} generated and ${String(shareAlike.length)} CC BY-NC-SA knowledge records`,
);
