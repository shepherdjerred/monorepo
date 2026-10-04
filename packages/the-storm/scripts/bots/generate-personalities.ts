/**
 * Generates a batch of rwfbots personalities: stratified traits from a seed,
 * gamer-tag names checked against Mojang, procedural skins signed through
 * MineSkin, one YAML per personality plus a manifest. See README.md.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { MineSkin } from "./mineskin.ts";
import { MojangNames } from "./mojang.ts";
import { nameIsAcceptable, nameToId, nextCandidateName } from "./names.ts";
import { Rng } from "./random.ts";
import {
  catalogProblems,
  ManifestSchema,
  namesAreDistinct,
  PersonalitySchema,
  type Manifest,
  type Personality,
} from "./schema.ts";
import { encodePng, renderSkin, sha256Hex } from "./skin-png.ts";
import { enrichWithLlm, planBatch, sampleTraits } from "./traits.ts";
import { toYaml } from "./yaml.ts";

const GENERATOR = "the-storm/scripts/bots/generate-personalities.ts";
const GENERATOR_VERSION = "1.0.0";
const USER_AGENT = `the-storm-rwfbots-generator/${GENERATOR_VERSION} (+https://github.com/shepherdjerred/monorepo)`;
/** How many candidates to try per accepted name before giving up on the lists. */
const MAX_CANDIDATES_PER_NAME = 200;

const packageRoot = path.resolve(import.meta.dir, "..", "..");

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    seed: { type: "string" },
    count: { type: "string" },
    batch: { type: "string" },
    "batch-number": { type: "string", default: "1" },
    out: {
      type: "string",
      default: path.join(
        packageRoot,
        "server/owned/plugins/TheStorm/rwfbots/personalities",
      ),
    },
    "skins-dir": {
      type: "string",
      default: path.join(packageRoot, "scripts/bots/skins"),
    },
    "skins-from": { type: "string" },
    offline: { type: "boolean", default: false },
  },
  strict: true,
});

function required(name: "seed" | "count" | "batch"): string {
  const value = values[name];
  if (value === undefined || value === "") {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function integer(name: "count" | "batch-number", raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${name} must be a positive integer, got ${raw}`);
  }
  return value;
}

const seed = required("seed");
const count = integer("count", required("count"));
const batch = required("batch");
const batchNumber = integer("batch-number", values["batch-number"]);
const outDir = values.out;
const skinsDir = values["skins-dir"];
const skinsFrom = values["skins-from"];
const offline = values.offline;

type Previous = {
  manifest: Manifest;
  personalities: Map<string, Personality>;
};

/** A previous run's output, for reusing its signed textures. */
async function loadPrevious(directory: string): Promise<Previous> {
  const manifest = ManifestSchema.parse(
    await Bun.file(path.join(directory, "manifest.json")).json(),
  );
  const personalities = new Map<string, Personality>();
  for (const entry of manifest.personalities) {
    const yaml = await Bun.file(path.join(directory, `${entry.id}.yml`)).text();
    personalities.set(entry.id, PersonalitySchema.parse(Bun.YAML.parse(yaml)));
  }
  return { manifest, personalities };
}

type Rejections = { local: number; similar: number; taken: number };

/** `count` names that pass every rule, in generation order. */
async function chooseNames(
  rng: Rng,
  mojang: MojangNames | undefined,
  rejections: Rejections,
): Promise<string[]> {
  const chosen: string[] = [];
  let tried = 0;
  while (chosen.length < count) {
    if (tried > MAX_CANDIDATES_PER_NAME * count) {
      throw new Error(
        `could not find ${String(count)} acceptable names from the word lists`,
      );
    }
    tried++;
    const candidate = nextCandidateName(rng);
    if (!nameIsAcceptable(candidate)) {
      rejections.local++;
      continue;
    }
    if (!chosen.every((name) => namesAreDistinct(name, candidate))) {
      rejections.similar++;
      continue;
    }
    if (mojang !== undefined && (await mojang.status(candidate)) === "taken") {
      rejections.taken++;
      console.error(`  name ${candidate} is taken; skipping`);
      continue;
    }
    chosen.push(candidate);
  }
  return chosen;
}

type Signer = {
  previous: Previous | undefined;
  mineskin: MineSkin | undefined;
};
type UnsignedSkin = {
  id: string;
  name: string;
  png: Uint8Array<ArrayBuffer>;
  skinSha256: string;
};
type SignedSkin = {
  skin: Personality["skin"];
  mineskinUuid: string;
  textureUrl: string;
  reused: boolean;
};

/**
 * The signed texture for a skin: reused from a previous run when the id and
 * pixel hash match, otherwise freshly generated through MineSkin. Offline runs
 * never fabricate a texture; they fail when nothing can be reused.
 */
async function signSkin(
  signer: Signer,
  unsigned: UnsignedSkin,
  progress: string,
): Promise<SignedSkin> {
  const cached = signer.previous?.manifest.personalities.find(
    (entry) =>
      entry.id === unsigned.id && entry.skinSha256 === unsigned.skinSha256,
  );
  const cachedSkin = signer.previous?.personalities.get(unsigned.id)?.skin;
  if (cached !== undefined && cachedSkin !== undefined) {
    return {
      skin: cachedSkin,
      mineskinUuid: cached.mineskinUuid,
      textureUrl: cached.textureUrl,
      reused: true,
    };
  }
  if (signer.mineskin === undefined) {
    throw new Error(
      `--offline needs a signed texture for ${unsigned.id} in --skins-from; none matched its skin`,
    );
  }
  console.error(`  skin ${unsigned.id}: asking MineSkin (${progress})`);
  const texture = await signer.mineskin.generate(unsigned.png, unsigned.name);
  return {
    skin: { value: texture.value, signature: texture.signature },
    mineskinUuid: texture.mineskinUuid,
    textureUrl: texture.textureUrl,
    reused: false,
  };
}

async function main(): Promise<void> {
  const rng = new Rng(seed);
  const slots = planBatch(rng.fork("plan"), count);
  const previous =
    skinsFrom === undefined ? undefined : await loadPrevious(skinsFrom);
  const mojang = offline
    ? undefined
    : new MojangNames({ userAgent: USER_AGENT, paceMs: 400 });
  const mineskin = offline
    ? undefined
    : new MineSkin({
        userAgent: USER_AGENT,
        apiKey: Bun.env["MINESKIN_API_KEY"],
      });

  console.error(
    `generating ${String(count)} personalities for batch ${batch} from seed ${seed}`,
  );
  const rejections: Rejections = { local: 0, similar: 0, taken: 0 };
  const names = await chooseNames(rng.fork("names"), mojang, rejections);
  console.error(
    `names: ${String(rejections.local)} failed local rules, ${String(rejections.similar)} too similar, ${String(rejections.taken)} taken on Mojang`,
  );

  const personalities: Personality[] = [];
  const manifestEntries: Manifest["personalities"] = [];
  let reused = 0;
  for (const [index, slot] of slots.entries()) {
    const name = names[index];
    if (name === undefined) {
      throw new Error(`no name for slot ${String(index)}`);
    }
    const id = nameToId(name);
    const traits = enrichWithLlm(
      sampleTraits(rng.fork(`traits:${String(index)}`), slot),
    );
    const png = encodePng(
      renderSkin(rng.fork(`skin:${String(index)}`), slot.archetype),
    );
    const skinSha256 = sha256Hex(png);
    await Bun.write(path.join(skinsDir, `${id}.png`), png);

    const signed = await signSkin(
      { previous, mineskin },
      { id, name, png, skinSha256 },
      `${String(index + 1)}/${String(count)}`,
    );
    if (signed.reused) {
      reused++;
    }
    const { mineskinUuid, textureUrl } = signed;

    personalities.push(
      PersonalitySchema.parse({
        id,
        name,
        skin: signed.skin,
        skill: traits.skill,
        leverOffsets: traits.leverOffsets,
        kits: traits.kits,
        roles: traits.roles,
        style: traits.style,
        chat: traits.chat,
        bio: traits.bio,
        batch: batchNumber,
        retired: false,
      }),
    );
    manifestEntries.push({ id, name, skinSha256, mineskinUuid, textureUrl });
  }

  const problems = catalogProblems(personalities);
  if (problems.length > 0) {
    throw new Error(`generated catalog is invalid:\n${problems.join("\n")}`);
  }

  const manifest: Manifest = ManifestSchema.parse({
    generator: GENERATOR,
    generatorVersion: GENERATOR_VERSION,
    seed,
    count,
    batch,
    batchNumber,
    generatedAt: new Date().toISOString(),
    unverifiedNames: offline,
    personalities: manifestEntries,
  });
  for (const personality of personalities) {
    await Bun.write(
      path.join(outDir, `${personality.id}.yml`),
      toYaml(personality),
    );
  }
  await Bun.write(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.error(
    `wrote ${String(personalities.length)} personalities to ${outDir} (${String(reused)} textures reused${offline ? ", names unverified" : ""})`,
  );
}

await main();
