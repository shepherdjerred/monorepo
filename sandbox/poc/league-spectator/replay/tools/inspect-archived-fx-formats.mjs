import path from "node:path";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { identifyArchivedFxFormat } from "./archived-fx-formats.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";

const [rootArg, output] = process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun inspect-archived-fx-formats.mjs <closed-fx-inventory> <output.json>",
  );
const root = path.resolve(rootArg),
  manifestBytes = await Bun.file(path.join(root, "manifest.json")).bytes(),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
if (
  manifest.kind !== "archived-map11-fx-source-inventory" ||
  manifest.nativeSpectatorAdmitted !== false
)
  throw Error("Exact original FX inventory required");
const selected = new Map();
for (const entry of manifest.files) {
  sceneAnimationFilePath(entry.file);
  if (selected.has(entry.file)) throw Error("Duplicate FX inventory file");
  selected.set(entry.file, entry);
}
const formats = {},
  translations = {},
  resources = [];
for (const entry of selected.values()) {
  const bytes = await Bun.file(path.join(root, entry.file)).bytes();
  if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256)
    throw Error(`FX inventory resource changed: ${entry.file}`);
  if (!entry.file.startsWith("assets/")) continue;
  const format = identifyArchivedFxFormat(bytes),
    name = `${format.format}${format.extendedFormat === undefined ? "" : `:${format.extendedFormat}`}`;
  formats[name] = (formats[name] ?? 0) + 1;
  translations[format.translation] =
    (translations[format.translation] ?? 0) + 1;
  resources.push({ ...entry, ...format });
}
const result = {
  schema: 1,
  kind: "archived-fx-format-inventory",
  sourceManifestSha256: sha(manifestBytes),
  sourceSceneSha256: manifest.sceneManifestSha256,
  verifiedFiles: selected.size,
  formats,
  translations,
  resources,
  nativeSpectatorAdmitted: false,
};
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    verifiedFiles: selected.size,
    formats,
    translations,
    nativeSpectatorAdmitted: false,
  }),
);
