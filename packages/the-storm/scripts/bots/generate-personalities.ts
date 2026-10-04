/**
 * Generates one batch of rwfbots personalities on top of the shipped catalog:
 * archetype-stratified traits from a seed, gamer-tag names checked against
 * Mojang, procedural skins signed through MineSkin, and authored text merged
 * from enrichment files. Writes one YAML per personality plus a manifest. See
 * README.md.
 */
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  enrichmentFor,
  loadEnrichment,
  type LoadedEnrichment,
} from "./enrichment.ts";
import { MineSkin } from "./mineskin.ts";
import { MojangNames } from "./mojang.ts";
import { chooseNames, nameToId, type Rejections } from "./names.ts";
import { Rng } from "./random.ts";
import {
  catalogProblems,
  IdentitySchema,
  ManifestSchema,
  PersonalitySchema,
  type Archetype,
  type BatchRecord,
  type Identity,
  type Manifest,
  type ManifestEntry,
  type Personality,
} from "./schema.ts";
import { encodePng, sha256Hex } from "./png.ts";
import { renderSkin } from "./skin-png.ts";
import {
  loadPrevious,
  loadTextureCache,
  signSkin,
  type Signer,
} from "./textures.ts";
import {
  bandOf,
  planBatch,
  sampleSkill,
  sampleTraits,
  type Traits,
} from "./traits.ts";
import { toYaml } from "./yaml.ts";

const GENERATOR = "the-storm/scripts/bots/generate-personalities.ts";
const GENERATOR_VERSION = "2.0.0";
const USER_AGENT = `the-storm-rwfbots-generator/${GENERATOR_VERSION} (+https://github.com/shepherdjerred/monorepo)`;

const packageRoot = path.resolve(import.meta.dir, "..", "..");

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    seed: { type: "string" },
    count: { type: "string" },
    batch: { type: "string" },
    "batch-number": { type: "string" },
    enrich: { type: "string", multiple: true },
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
    "texture-cache": { type: "string" },
    prepare: { type: "string" },
    "max-sign": { type: "string" },
    refresh: { type: "boolean", default: false },
    offline: { type: "boolean", default: false },
  },
  strict: true,
});

function required(name: "seed" | "count" | "batch" | "batch-number"): string {
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

/** What a run adds: a new or regenerated batch, or nothing for `--refresh`. */
type BatchArgs = {
  seed: string;
  count: number;
  batch: string;
  batchNumber: number;
};

function batchArgs(): BatchArgs | undefined {
  if (values.refresh) {
    for (const flag of ["seed", "count", "batch", "batch-number"] as const) {
      if (values[flag] !== undefined) {
        throw new Error(`--refresh adds no batch; drop --${flag}`);
      }
    }
    return undefined;
  }
  return {
    seed: required("seed"),
    count: integer("count", required("count")),
    batch: required("batch"),
    batchNumber: integer("batch-number", required("batch-number")),
  };
}

const target = batchArgs();
const enrichFiles = values.enrich ?? [];
const outDir = values.out;
const skinsDir = values["skins-dir"];
const skinsFrom = values["skins-from"];
const textureCachePath = values["texture-cache"];
const prepareRoster = values.prepare;
const maxSign =
  values["max-sign"] === undefined
    ? Number.POSITIVE_INFINITY
    : integer("count", values["max-sign"]);
const offline = values.offline;
if (prepareRoster === undefined && enrichFiles.length === 0) {
  throw new Error(
    "--enrich <file.json> is required (repeatable); use --prepare <roster.json> to plan a batch before its text is written",
  );
}

/** A personality already in the catalog that this run keeps. */
type Carried = { identity: Identity; entry: ManifestEntry };

type Catalog = {
  batches: BatchRecord[];
  carried: Carried[];
  /** Ids of the target batch in the previous catalog, which this run replaces. */
  replaced: string[];
};

/** The shipped catalog, minus the batch this run (re)generates, if any. */
async function loadCatalog(
  directory: string,
  batchNumber: number | undefined,
): Promise<Catalog> {
  const manifestFile = Bun.file(path.join(directory, "manifest.json"));
  if (!(await manifestFile.exists())) {
    return { batches: [], carried: [], replaced: [] };
  }
  const manifest = ManifestSchema.parse(await manifestFile.json());
  const carried: Carried[] = [];
  const replaced: string[] = [];
  for (const entry of manifest.personalities) {
    if (entry.batchNumber === batchNumber) {
      replaced.push(entry.id);
      continue;
    }
    const yaml = await Bun.file(path.join(directory, `${entry.id}.yml`)).text();
    const identity = IdentitySchema.parse(Bun.YAML.parse(yaml));
    if (identity.id !== entry.id || identity.batch !== entry.batchNumber) {
      throw new Error(`${entry.id}.yml does not match its manifest entry`);
    }
    carried.push({ identity, entry });
  }
  return {
    batches: manifest.batches.filter((b) => b.batchNumber !== batchNumber),
    carried,
    replaced,
  };
}

/** One personality before its authored text is merged. */
type Draft = {
  id: string;
  name: string;
  skin: Personality["skin"];
  skill: number;
  archetype: Archetype;
  traits: Traits;
  batch: number;
  retired: boolean;
  entry: ManifestEntry;
};

/**
 * The knobs of a personality: a pure function of its batch seed, id and
 * archetype, so carried personalities pick up profile changes and a batch can
 * be regenerated bit for bit.
 */
function traitsOf(batchSeed: string, id: string, archetype: Archetype): Traits {
  return sampleTraits(new Rng(`${batchSeed}:traits:${id}`), archetype);
}

function carriedDraft(
  batches: readonly BatchRecord[],
  carried: Carried,
): Draft {
  const record = batches.find(
    (b) => b.batchNumber === carried.entry.batchNumber,
  );
  if (record === undefined) {
    throw new Error(`${carried.entry.id}: its batch is not in the manifest`);
  }
  const { identity, entry } = carried;
  return {
    id: identity.id,
    name: identity.name,
    skin: identity.skin,
    skill: identity.skill,
    archetype: entry.archetype,
    traits: traitsOf(record.seed, identity.id, entry.archetype),
    batch: identity.batch,
    retired: identity.retired,
    entry,
  };
}

/** What authors need to write a personality's text: who it is and how it plays. */
type RosterEntry = Pick<
  Draft,
  "id" | "name" | "batch" | "archetype" | "skill" | "traits"
>;

async function writeRoster(
  file: string,
  entries: readonly RosterEntry[],
): Promise<void> {
  const roster = entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    batch: entry.batch,
    archetype: entry.archetype,
    skill: entry.skill,
    band: bandOf(entry.skill),
    ...entry.traits,
  }));
  await Bun.write(file, `${JSON.stringify(roster, null, 2)}\n`);
  console.error(`wrote the roster of ${String(roster.length)} to ${file}`);
}

type Planned = {
  id: string;
  name: string;
  archetype: Archetype;
  skill: number;
  traits: Traits;
};

/** Names, skill and knobs for every slot of the new batch. */
async function planNew(
  args: BatchArgs,
  carried: readonly Draft[],
): Promise<Planned[]> {
  const rng = new Rng(args.seed);
  const slots = planBatch(rng.fork("plan"), args.count, carried);
  const mojang = offline
    ? undefined
    : new MojangNames({ userAgent: USER_AGENT, paceMs: 400 });
  const rejections: Rejections = { local: 0, similar: 0, taken: 0 };
  const names = await chooseNames(rng.fork("names"), {
    count: args.count,
    mojang,
    existing: carried.map((draft) => draft.name),
    rejections,
  });
  console.error(
    `names: ${String(rejections.local)} failed local rules, ${String(rejections.similar)} too similar, ${String(rejections.taken)} taken on Mojang`,
  );
  return slots.map((slot, index) => {
    const name = names[index];
    if (name === undefined) {
      throw new Error(`no name for slot ${String(index)}`);
    }
    const id = nameToId(name);
    return {
      id,
      name,
      archetype: slot.archetype,
      skill: sampleSkill(new Rng(`${args.seed}:skill:${id}`), slot.band),
      traits: traitsOf(args.seed, id, slot.archetype),
    };
  });
}

/**
 * Draws and signs every planned skin. Returns undefined when `--max-sign`
 * stopped the run early; the texture cache keeps what was signed.
 */
async function skinNew(
  args: BatchArgs,
  planned: readonly Planned[],
): Promise<Draft[] | undefined> {
  await mkdir(skinsDir, { recursive: true });
  const signer: Signer = {
    previous:
      skinsFrom === undefined ? undefined : await loadPrevious(skinsFrom),
    cache: await loadTextureCache(textureCachePath),
    cacheFile: textureCachePath,
    mineskin: offline
      ? undefined
      : new MineSkin({
          userAgent: USER_AGENT,
          apiKey: Bun.env["MINESKIN_API_KEY"],
        }),
  };
  const drafts: Draft[] = [];
  let signedNow = 0;
  for (const [index, plan] of planned.entries()) {
    const png = encodePng(
      renderSkin(new Rng(`${args.seed}:skin:${plan.id}`), plan.archetype),
    );
    const skinSha256 = sha256Hex(png);
    await Bun.write(path.join(skinsDir, `${plan.id}.png`), png);
    if (signedNow >= maxSign && !signer.cache.has(skinSha256)) {
      console.error(
        `--max-sign: stopped after signing ${String(signedNow)}; ${String(planned.length - index)} skins left. Run again to continue.`,
      );
      return undefined;
    }
    const signed = await signSkin(
      signer,
      { id: plan.id, name: plan.name, png, skinSha256 },
      `${String(index + 1)}/${String(args.count)}`,
    );
    if (!signed.reused) {
      signedNow++;
    }
    drafts.push({
      ...plan,
      skin: signed.skin,
      batch: args.batchNumber,
      retired: false,
      entry: {
        id: plan.id,
        name: plan.name,
        batchNumber: args.batchNumber,
        archetype: plan.archetype,
        skinSha256,
        mineskinUuid: signed.mineskinUuid,
        textureUrl: signed.textureUrl,
      },
    });
  }
  console.error(
    `skins: ${String(signedNow)} signed through MineSkin, ${String(planned.length - signedNow)} reused`,
  );
  return drafts;
}

/** Every draft with its authored text, validated alone and as a catalog. */
function merge(
  drafts: readonly Draft[],
  enrichment: LoadedEnrichment,
): Personality[] {
  const texts = enrichmentFor(
    enrichment,
    drafts.map((draft) => draft.id),
  );
  const personalities = drafts.map((draft, index) => {
    const text = texts[index];
    if (text === undefined) {
      throw new Error(`no enrichment for ${draft.id}`);
    }
    const result = PersonalitySchema.safeParse({
      id: draft.id,
      name: draft.name,
      skin: draft.skin,
      skill: draft.skill,
      archetype: draft.archetype,
      leverOffsets: draft.traits.leverOffsets,
      kits: draft.traits.kits,
      roles: draft.traits.roles,
      style: draft.traits.style,
      voice: text.voice,
      lines: text.lines,
      quirks: text.quirks,
      rivals: text.rivals,
      bio: text.bio,
      batch: draft.batch,
      retired: draft.retired,
    });
    if (!result.success) {
      throw new Error(`${draft.id}: ${result.error.message}`);
    }
    return result.data;
  });
  const problems = catalogProblems(personalities);
  if (problems.length > 0) {
    throw new Error(`generated catalog is invalid:\n${problems.join("\n")}`);
  }
  return personalities;
}

async function main(): Promise<void> {
  const catalog = await loadCatalog(outDir, target?.batchNumber);
  const carried = catalog.carried.map((c) => carriedDraft(catalog.batches, c));
  const enrichment =
    enrichFiles.length > 0 ? await loadEnrichment(enrichFiles) : undefined;

  let fresh: Draft[] = [];
  const batches = [...catalog.batches];
  if (target === undefined) {
    console.error(
      `refreshing ${String(carried.length)} personalities from the manifest and enrichment`,
    );
  } else {
    console.error(
      `generating ${String(target.count)} personalities for batch ${target.batch} (#${String(target.batchNumber)}) from seed ${target.seed} on top of ${String(carried.length)} carried`,
    );
    const planned = await planNew(target, carried);
    if (prepareRoster !== undefined) {
      await writeRoster(prepareRoster, [
        ...carried,
        ...planned.map((plan) => ({ ...plan, batch: target.batchNumber })),
      ]);
    }
    const skinned = await skinNew(target, planned);
    if (skinned === undefined) {
      return;
    }
    fresh = skinned;
    batches.push({
      batch: target.batch,
      batchNumber: target.batchNumber,
      seed: target.seed,
      count: target.count,
      generatedAt: new Date().toISOString(),
      generatorVersion: GENERATOR_VERSION,
      unverifiedNames: offline,
    });
  }
  if (enrichment === undefined) {
    console.error("--prepare: names planned and skins signed; nothing written");
    return;
  }

  const drafts = [...carried, ...fresh];
  const personalities = merge(drafts, enrichment);
  const manifest: Manifest = ManifestSchema.parse({
    generator: GENERATOR,
    generatorVersion: GENERATOR_VERSION,
    batches: batches.toSorted((a, b) => a.batchNumber - b.batchNumber),
    enrichment: enrichment.files.map((file) =>
      path.relative(packageRoot, path.resolve(file)),
    ),
    personalities: drafts.map((draft) => draft.entry),
  });

  const kept = new Set(personalities.map((personality) => personality.id));
  for (const id of catalog.replaced.filter((stale) => !kept.has(stale))) {
    await unlink(path.join(outDir, `${id}.yml`));
    await unlink(path.join(skinsDir, `${id}.png`));
  }
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
    `wrote ${String(personalities.length)} personalities to ${outDir}${offline ? " (names unverified)" : ""}`,
  );
}

await main();
