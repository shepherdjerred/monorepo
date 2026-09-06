#!/usr/bin/env bun
import { z } from "zod";
import { first } from "remeda";
import { $ } from "bun";
import { SummonerSchema } from "#src/data-dragon/summoner.ts";
import { RuneTreeSchema } from "#src/data-dragon/runes.ts";
import {
  ItemSchema,
  ChampionListSchema,
  ArenaAugmentsApiResponseSchema,
  CDragonChampionSchema,
  rarityNumberToString,
  type SummonerData,
  type ItemData,
  type RuneTreeData,
  type ArenaAugmentCacheEntry,
  type ChampionListData,
  type CDragonChampion,
} from "./update-data-dragon-schemas.ts";
import {
  buildPatchChangelogEntryLiteral,
  insertChangelogEntry,
  isMinorVersionBump,
  minorVersionKey,
} from "./update-changelog.ts";
import {
  fetchPatches,
  selectPatchByMinor,
  type RiotPatch,
} from "./riot-patch.ts";
import { generateAbilityFactsAssets } from "./ability-facts.ts";
import { analyzePatch, fetchOfficialPatchNotes } from "./patch-analysis.ts";

const ASSETS_DIR = `${import.meta.dir}/../src/data-dragon/assets`;
const IMG_DIR = `${ASSETS_DIR}/img`;
// scout-for-lol/packages/data/scripts → scout-for-lol/packages/frontend/...
const CHANGELOG_FILE = `${import.meta.dir}/../../frontend/src/data/changelog.tsx`;
// Structured patch changeset consumed at review time (bundled asset).
const PATCH_NOTES_ASSET = `${ASSETS_DIR}/patch-notes.json`;
// Raw patch-notes provenance — committed but not imported at runtime.
const PATCH_NOTES_ARCHIVE_DIR = `${import.meta.dir}/../patch-notes-archive`;
// scout-for-lol/packages/data/scripts → monorepo root (for resolving prettier).
const MONOREPO_ROOT = `${import.meta.dir}/../../../../..`;
const BASE_URL = "https://ddragon.leagueoflegends.com";
const BYTES_PER_MIB = 1024 * 1024;
const MAX_LOADING_SCREEN_IMAGE_BYTES = 1 * BYTES_PER_MIB;
// Splash art is higher-resolution than loading art (centered CDragon ~85 KB,
// Data Dragon splash ~180 KB), so it gets a slightly larger ceiling.
const MAX_SPLASH_IMAGE_BYTES = 2 * BYTES_PER_MIB;
const CLASSIC_BACKGROUND_PATH = `${IMG_DIR}/background/classic-jade.png`;

/**
 * CommunityDragon *centered* splash art (≈1280×720) keyed by numeric champion
 * id. Centered composition keeps the champion framed when the ranked report
 * designs crop the wide splash to their banner / square canvases. Verified 200
 * for id 62 (Wukong) skin 0/1 on 2026-07-25.
 */
export function getCDragonCenteredSplashUrl(
  dataDragonVersion: string,
  championId: number,
  skinNum: number,
): string {
  return `https://cdn.communitydragon.org/${dataDragonVersion}/champion/${championId.toString()}/splash-art/centered/skin/${skinNum.toString()}`;
}

export function getCommunityDragonVersion(dataDragonVersion: string): string {
  const parts = dataDragonVersion.split(".");
  return `${parts[0]}.${parts[1]}`;
}

function getCommunityDragonUrl(cdVersion: string): string {
  return `https://raw.communitydragon.org/${cdVersion}/game`;
}

function getCommunityDragonPositionsUrl(cdVersion: string): string {
  return `https://raw.communitydragon.org/${cdVersion}/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions`;
}

function getArenaAugmentsUrl(cdVersion: string): string {
  return `https://raw.communitydragon.org/${cdVersion}/cdragon/arena/en_us.json`;
}

function getCDragonLolGameDataBase(cdVersion: string): string {
  return `https://raw.communitydragon.org/${cdVersion}/plugins/rcp-be-lol-game-data/global/default`;
}

export function getCDragonChampionJsonUrl(
  cdVersion: string,
  championId: number,
): string {
  return `${getCDragonLolGameDataBase(cdVersion)}/v1/champions/${championId.toString()}.json`;
}

/**
 * CommunityDragon per-champion game bin (converted `.bin` → JSON), keyed by
 * the champion's internal alias — identical to the Data Dragon id/key (e.g.
 * "MonkeyKing"), lowercased. Carries `mSpell.DataValues` and
 * `mSpellCalculations`, the only public source for ability damage numbers
 * (Data Dragon tooltips leave them as unresolved templates). Verified 200 for
 * chogath/pyke/karthus on 16.16 on 2026-09-05.
 */
export function getCDragonChampionBinUrl(
  cdVersion: string,
  championAlias: string,
): string {
  const lowered = championAlias.toLowerCase();
  return `https://raw.communitydragon.org/${cdVersion}/game/data/characters/${lowered}/${lowered}.bin.json`;
}

/**
 * Resolve a CommunityDragon `lol-game-data` asset URL.
 *
 * `loadScreenPath` values look like
 *   `/lol-game-data/assets/ASSETS/Characters/Fiddlesticks/Skins/Skin27/FiddleSticksLoadscreen_27.jpg`
 *
 * To fetch them: lowercase, strip the leading `/lol-game-data/assets`, then
 * prepend the rcp-be-lol-game-data plugin path. Verified against the live
 * CDN (e.g. Fiddlesticks_27 = HTTP 200, ~49 KB) on 2026-04-25.
 */
export function resolveCDragonAssetUrl(
  cdVersion: string,
  loadScreenPath: string,
): string {
  const lowered = loadScreenPath.toLowerCase();
  const stripped = lowered.startsWith("/lol-game-data/assets")
    ? lowered.slice("/lol-game-data/assets".length)
    : lowered;
  return `${getCDragonLolGameDataBase(cdVersion)}${stripped}`;
}

/**
 * `fetch` with bounded retries for transient failures (network errors and 5xx).
 * Data Dragon / CommunityDragon occasionally blip during a fresh patch release;
 * a single attempt turns that into a hard failure. 4xx responses are returned
 * as-is (not retried) — callers decide what a 404 means (e.g. the two-tier
 * loading-screen fallback, or the propagation-lag retry pass below), and fast
 * retries don't help a "not yet published" asset anyway.
 */
async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options: { attempts?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.status < 500) {
        return response;
      }
      lastError = new Error(`HTTP ${String(response.status)} from ${url}`);
      // Discard the 5xx body so the TCP connection returns to the pool
      // immediately instead of waiting on GC — matters across the many
      // requests this script makes when several 5xx land in a retry window.
      void response.body?.cancel();
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await Bun.sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`fetch failed for ${url}: ${String(lastError)}`);
}

const cdragonChampionCache = new Map<string, CDragonChampion | undefined>();

/**
 * Fetch (and cache) the CommunityDragon per-champion JSON. Returns `undefined`
 * if the lookup fails — callers must treat that as "no fallback available".
 */
async function fetchCDragonChampion(
  cdVersion: string,
  championId: number,
): Promise<CDragonChampion | undefined> {
  const cacheKey = `${cdVersion}:${championId.toString()}`;
  if (cdragonChampionCache.has(cacheKey)) {
    return cdragonChampionCache.get(cacheKey);
  }
  try {
    const response = await fetchWithRetry(
      getCDragonChampionJsonUrl(cdVersion, championId),
    );
    if (!response.ok) {
      // Definitive miss (e.g. 404) — safe to cache so we don't re-request it.
      cdragonChampionCache.set(cacheKey, undefined);
      return undefined;
    }
    const data: unknown = await response.json();
    const parsed = CDragonChampionSchema.parse(data);
    cdragonChampionCache.set(cacheKey, parsed);
    return parsed;
  } catch {
    // Transient (network error after retries, or a parse blip during fresh-patch
    // propagation). Do NOT cache `undefined` — caching it here would blank the
    // CommunityDragon fallback for EVERY skin of this champion for the whole run.
    // Leaving it uncached lets the loading-screen propagation-lag retry re-fetch.
    return undefined;
  }
}

async function ensureDir(path: string): Promise<void> {
  await $`mkdir -p ${path}`;
}

async function getLatestVersion(): Promise<string> {
  console.log("Fetching latest version...");
  const response = await fetchWithRetry(`${BASE_URL}/api/versions.json`);
  const data: unknown = await response.json();
  const versions = z.array(z.string()).parse(data);
  const latestVersion = first(versions);
  if (latestVersion === undefined) {
    throw new Error("No versions available");
  }
  return latestVersion;
}

async function downloadAsset<T>(
  version: string,
  filename: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const url = `${BASE_URL}/cdn/${version}/data/en_US/${filename}`;
  console.log(`Downloading ${filename} from ${url}...`);

  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${filename}: ${String(response.status)} ${response.statusText}`,
    );
  }

  const data: unknown = await response.json();

  // Validate with schema
  console.log(`Validating ${filename}...`);
  const validated = schema.parse(data);

  return validated;
}

async function downloadImage(url: string, outputPath: string): Promise<void> {
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image ${url}: ${String(response.status)}`);
  }
  const buffer = await response.arrayBuffer();
  await Bun.write(outputPath, buffer);
}

function formatMib(bytes: number): string {
  return `${(bytes / BYTES_PER_MIB).toFixed(2)} MiB`;
}

function assertFileSizeAtMost(
  path: string,
  maxBytes: number,
  description: string,
): void {
  const size = Bun.file(path).size;
  if (size > maxBytes) {
    throw new Error(
      `${description} is ${formatMib(size)}, which exceeds ${formatMib(maxBytes)}: ${path}`,
    );
  }
}

async function downloadImagesInBatches(
  items: { url: string; path: string; name: string }[],
  batchSize = 10,
): Promise<void> {
  let completed = 0;
  const total = items.length;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (item) => {
        try {
          await downloadImage(item.url, item.path);
          completed++;
          if (completed % 20 === 0 || completed === total) {
            console.log(
              `  Downloaded ${String(completed)}/${String(total)} images...`,
            );
          }
        } catch (error) {
          console.warn(`  ⚠ Failed to download ${item.name}: ${String(error)}`);
        }
      }),
    );
  }
}

async function createDirectories(): Promise<void> {
  await ensureDir(ASSETS_DIR);
  await ensureDir(`${IMG_DIR}/champion`);
  await ensureDir(`${IMG_DIR}/item`);
  await ensureDir(`${IMG_DIR}/spell`);
  await ensureDir(`${IMG_DIR}/rune`);
  await ensureDir(`${IMG_DIR}/augment`);
  await ensureDir(`${IMG_DIR}/lane`);
  await ensureDir(`${IMG_DIR}/champion-loading`);
  await ensureDir(`${IMG_DIR}/champion-splash`);
  await ensureDir(`${IMG_DIR}/background`);
  await ensureDir(`${ASSETS_DIR}/champion`);
  await ensureDir(`${ASSETS_DIR}/ability-facts`);
}

/**
 * Regenerate `assets/ability-facts/{Key}.json` for every (non-Classic)
 * champion from the freshly written Data Dragon champion files plus each
 * champion's CommunityDragon bin. Throws (non-zero exit) when any champion
 * fails to fetch or parse.
 */
async function generateAbilityFacts(
  cdVersion: string,
  championNames: string[],
): Promise<void> {
  console.log("\nGenerating ability-facts assets from CommunityDragon bins...");
  await generateAbilityFactsAssets({
    championKeys: championNames,
    assetsDir: ASSETS_DIR,
    fetchBin: async (championKey) => {
      const response = await fetchWithRetry(
        getCDragonChampionBinUrl(cdVersion, championKey),
      );
      if (!response.ok) {
        throw new Error(
          `Failed to fetch champion bin for ${championKey}: HTTP ${String(response.status)} ${response.statusText}`,
        );
      }
      const data: unknown = await response.json();
      return data;
    },
  });
  console.log(
    `✓ Generated ability facts for ${String(championNames.length)} champions`,
  );
}

async function downloadClassicBackground(cdVersion: string): Promise<void> {
  const classicBackgroundUrl = `https://raw.communitydragon.org/${cdVersion}/game/assets/ux/loadingscreen/jade.png`;
  console.log(
    `\nDownloading League Classic loading-screen background from ${classicBackgroundUrl}...`,
  );
  await downloadImage(classicBackgroundUrl, CLASSIC_BACKGROUND_PATH);
  assertFileSizeAtMost(
    CLASSIC_BACKGROUND_PATH,
    MAX_SPLASH_IMAGE_BYTES,
    "League Classic loading-screen background",
  );
  console.log("✓ Downloaded League Classic loading-screen background");
}

async function writeJsonAssets(
  summoner: SummonerData,
  items: ItemData,
  runes: RuneTreeData,
  version: string,
): Promise<void> {
  console.log("\nWriting JSON assets to disk...");

  await Bun.write(
    `${ASSETS_DIR}/summoner.json`,
    JSON.stringify(summoner, null, 2),
  );
  console.log("✓ Written summoner.json");

  await Bun.write(`${ASSETS_DIR}/item.json`, JSON.stringify(items, null, 2));
  console.log("✓ Written item.json");

  await Bun.write(
    `${ASSETS_DIR}/runesReforged.json`,
    JSON.stringify(runes, null, 2),
  );
  console.log("✓ Written runesReforged.json");

  await Bun.write(
    `${ASSETS_DIR}/version.json`,
    JSON.stringify({ version }, null, 2),
  );
  console.log("✓ Written version.json");
}

type ClassicDiscovery = {
  entry: ChampionListData["data"][string];
  cdragon: CDragonChampion;
  isNew: boolean;
};

export function validateClassicMetadata(
  modernEntry: ChampionListData["data"][string],
  cdragon: CDragonChampion,
): void {
  const modernId = Number(modernEntry.key);
  const classicId = 60000 + modernId;
  if (
    cdragon.id !== classicId ||
    !cdragon.alias.startsWith("Jade_") ||
    cdragon.relatedPrimeItemId !== modernId ||
    cdragon.name !== modernEntry.name
  ) {
    throw new Error(
      `Classic metadata mismatch for ${modernEntry.id}: expected id=${String(classicId)}, Jade_ alias, relatedPrimeItemId=${modernEntry.key}, name=${modernEntry.name}; received id=${String(cdragon.id)}, alias=${cdragon.alias}, relatedPrimeItemId=${String(cdragon.relatedPrimeItemId)}, name=${cdragon.name}`,
    );
  }
}

export function classicCatalogEntryFromCDragon(
  modernEntry: ChampionListData["data"][string],
  cdragon: CDragonChampion,
): ChampionListData["data"][string] {
  validateClassicMetadata(modernEntry, cdragon);
  return {
    id: cdragon.alias,
    key: String(cdragon.id),
    name: cdragon.name,
    modernKey: modernEntry.key,
  };
}

export function mergeClassicChampionEntries(
  normalChampionList: ChampionListData,
  previousChampionList: ChampionListData | undefined,
  discoveredEntries: readonly ChampionListData["data"][string][],
): ChampionListData {
  const normalByKey = new Map(
    Object.values(normalChampionList.data).map((entry) => [entry.key, entry]),
  );
  const data = { ...normalChampionList.data };
  if (previousChampionList !== undefined) {
    for (const [id, entry] of Object.entries(previousChampionList.data)) {
      if (!entry.id.startsWith("Jade_") || id in data) {
        continue;
      }
      const classicKey = Number(entry.key);
      if (!Number.isInteger(classicKey) || classicKey < 60_000) {
        throw new Error(
          `Historical Classic entry ${entry.id} has invalid Classic key ${entry.key}`,
        );
      }
      const modernKey = String(classicKey - 60_000);
      const modern = normalByKey.get(modernKey);
      if (modern === undefined) {
        throw new Error(
          `Historical Classic entry ${entry.id} has no normal champion counterpart`,
        );
      }
      data[id] = { ...entry, modernKey: modern.key };
    }
  }
  for (const entry of discoveredEntries) {
    data[entry.id] = entry;
  }
  return ChampionListSchema.parse({ data });
}

async function discoverClassicChampions(
  cdVersion: string,
  normalChampionList: ChampionListData,
  previousClassicIds: ReadonlySet<string>,
): Promise<ClassicDiscovery[]> {
  const candidates = Object.values(normalChampionList.data);
  const discoveries: ClassicDiscovery[] = [];
  for (let index = 0; index < candidates.length; index += 10) {
    const batch = candidates.slice(index, index + 10);
    const results = await Promise.all(
      batch.map(async (modernEntry): Promise<ClassicDiscovery | undefined> => {
        const modernId = Number(modernEntry.key);
        const classicId = 60000 + modernId;
        const response = await fetchWithRetry(
          getCDragonChampionJsonUrl(cdVersion, classicId),
        );
        if (response.status === 404) {
          return undefined;
        }
        if (!response.ok) {
          throw new Error(
            `Classic probe for ${modernEntry.id} failed: HTTP ${String(response.status)} ${response.statusText}`,
          );
        }
        const data: unknown = await response.json();
        const cdragon = CDragonChampionSchema.parse(data);
        validateClassicMetadata(modernEntry, cdragon);
        return {
          entry: classicCatalogEntryFromCDragon(modernEntry, cdragon),
          cdragon,
          isNew: !previousClassicIds.has(cdragon.alias),
        };
      }),
    );
    discoveries.push(...results.filter((result) => result !== undefined));
  }
  return discoveries;
}

async function fetchChampionList(
  version: string,
  cdVersion: string,
): Promise<{
  championList: ChampionListData;
  discoveries: ClassicDiscovery[];
}> {
  console.log("\nFetching champion list...");
  const championListUrl = `${BASE_URL}/cdn/${version}/data/en_US/champion.json`;
  const championListResponse = await fetchWithRetry(championListUrl);
  const data: unknown = await championListResponse.json();
  const normalChampionList = ChampionListSchema.parse(data);
  const previousChampionListData = await (async () => {
    const previousChampionListFile = Bun.file(`${ASSETS_DIR}/champion.json`);
    if (!(await previousChampionListFile.exists())) {
      return undefined;
    }
    const previousData: unknown = await previousChampionListFile.json();
    return ChampionListSchema.parse(previousData);
  })();
  const previousClassicIds = new Set(
    previousChampionListData === undefined
      ? []
      : Object.values(previousChampionListData.data)
          .filter((entry) => entry.id.startsWith("Jade_"))
          .map((entry) => entry.id),
  );
  const discoveries = await discoverClassicChampions(
    cdVersion,
    normalChampionList,
    previousClassicIds,
  );
  const championListData = mergeClassicChampionEntries(
    normalChampionList,
    previousChampionListData,
    discoveries.map((discovery) => discovery.entry),
  );

  const championNames = Object.keys(championListData.data);
  console.log(`Found ${String(championNames.length)} champions`);

  await Bun.write(
    `${ASSETS_DIR}/champion.json`,
    JSON.stringify(championListData, null, 2),
  );
  console.log("✓ Written champion.json");

  return { championList: championListData, discoveries };
}

async function downloadSummonerSpellImages(
  version: string,
  summoner: SummonerData,
): Promise<number> {
  console.log("\nDownloading summoner spell images...");
  const spellImages = Object.entries(summoner.data).map(
    ([spellName, spell]) => ({
      url: `${BASE_URL}/cdn/${version}/img/spell/${spell.image.full}`,
      path: `${IMG_DIR}/spell/${spell.image.full}`,
      name: spellName,
    }),
  );
  await downloadImagesInBatches(spellImages, 5);
  console.log(
    `✓ Downloaded ${String(spellImages.length)} summoner spell images`,
  );
  return spellImages.length;
}

async function downloadItemImages(
  version: string,
  items: ItemData,
): Promise<number> {
  console.log("\nDownloading item images...");
  const itemImages = Object.keys(items.data).map((itemId) => ({
    url: `${BASE_URL}/cdn/${version}/img/item/${itemId}.png`,
    path: `${IMG_DIR}/item/${itemId}.png`,
    name: itemId,
  }));
  await downloadImagesInBatches(itemImages, 20);
  console.log(`✓ Downloaded ${String(itemImages.length)} item images`);
  return itemImages.length;
}

async function downloadChampionImages(
  version: string,
  championNames: string[],
): Promise<number> {
  console.log("\nDownloading champion portraits...");
  const championImages = championNames.map((championName) => ({
    url: `${BASE_URL}/cdn/${version}/img/champion/${championName}.png`,
    path: `${IMG_DIR}/champion/${championName}.png`,
    name: championName,
  }));
  await downloadImagesInBatches(championImages, 20);
  console.log(`✓ Downloaded ${String(championImages.length)} champion images`);
  return championImages.length;
}

async function downloadChampionData(
  version: string,
  championNames: string[],
): Promise<number> {
  console.log("\nDownloading individual champion data files...");
  let championDataCount = 0;
  for (const championName of championNames) {
    try {
      const url = `${BASE_URL}/cdn/${version}/data/en_US/champion/${championName}.json`;
      const response = await fetchWithRetry(url);
      if (response.ok) {
        const data: unknown = await response.json();
        await Bun.write(
          `${ASSETS_DIR}/champion/${championName}.json`,
          JSON.stringify(data, null, 2),
        );
        championDataCount++;
        if (championDataCount % 20 === 0) {
          console.log(
            `  Downloaded ${String(championDataCount)}/${String(championNames.length)} champion data files...`,
          );
        }
      }
    } catch (error) {
      console.warn(
        `  ⚠ Failed to download champion data for ${championName}: ${String(error)}`,
      );
    }
  }
  console.log(`✓ Downloaded ${String(championDataCount)} champion data files`);
  return championDataCount;
}

async function downloadClassicChampionAssets(
  version: string,
  cdVersion: string,
  championList: ChampionListData,
  discoveries: ClassicDiscovery[],
): Promise<number> {
  if (discoveries.length === 0) {
    return 0;
  }
  console.log("\nDownloading League Classic champion assets...");
  const normalByKey = new Map(
    Object.values(championList.data)
      .filter((entry) => !entry.id.startsWith("Jade_"))
      .map((entry) => [entry.key, entry]),
  );
  let dataCount = 0;
  for (const discovery of discoveries) {
    const { entry, cdragon } = discovery;
    const modern = normalByKey.get(entry.modernKey ?? "");
    if (modern === undefined) {
      throw new Error(
        `Classic champion ${entry.id} has no catalog data for modernKey ${entry.modernKey ?? "missing"}`,
      );
    }
    const portraitPath = `${IMG_DIR}/champion/${entry.id}.png`;
    await downloadImage(
      `https://cdn.communitydragon.org/${version}/champion/${entry.key}/square`,
      portraitPath,
    );
    assertFileSizeAtMost(
      portraitPath,
      MAX_LOADING_SCREEN_IMAGE_BYTES,
      `${entry.id} portrait`,
    );

    const baseSkin = cdragon.skins.find(
      (skin) => skin.id === Number(entry.key) * 1000,
    );
    if (
      baseSkin?.loadScreenPath === null ||
      baseSkin?.loadScreenPath === undefined
    ) {
      throw new Error(
        `Classic champion ${entry.id} has no base loading asset metadata`,
      );
    }
    const loadingPath = `${IMG_DIR}/champion-loading/${entry.id}_0.jpg`;
    await downloadImage(
      resolveCDragonAssetUrl(cdVersion, baseSkin.loadScreenPath),
      loadingPath,
    );
    assertFileSizeAtMost(
      loadingPath,
      MAX_LOADING_SCREEN_IMAGE_BYTES,
      `${entry.id} loading art`,
    );

    const splashPath = `${IMG_DIR}/champion-splash/${entry.id}_0.jpg`;
    await downloadImage(
      getCDragonCenteredSplashUrl(version, Number(entry.key), 0),
      splashPath,
    );
    assertFileSizeAtMost(
      splashPath,
      MAX_SPLASH_IMAGE_BYTES,
      `${entry.id} splash art`,
    );

    const response = await fetchWithRetry(
      `${BASE_URL}/cdn/${version}/data/en_US/champion/${modern.id}.json`,
    );
    if (!response.ok) {
      throw new Error(
        `Failed to fetch modern data for new Classic champion ${entry.id}: HTTP ${String(response.status)}`,
      );
    }
    const modernData: unknown = await response.json();
    const wrapper = z
      .object({ data: z.record(z.string(), z.unknown()) })
      .parse(modernData);
    const modernChampion = wrapper.data[modern.id];
    if (modernChampion === undefined) {
      throw new Error(
        `Modern catalog data for ${modern.id} is missing its champion record`,
      );
    }
    await Bun.write(
      `${ASSETS_DIR}/champion/${entry.id}.json`,
      JSON.stringify({ data: { [entry.id]: modernChampion } }, null, 2),
    );
    dataCount++;
  }
  console.log(
    `✓ Downloaded ${String(discoveries.length)} Classic champion asset sets`,
  );
  console.log(`✓ Generated ${String(dataCount)} Classic champion data files`);
  return discoveries.length;
}

type LoadingScreenSource = "ddragon" | "cdragon";

type LoadingScreenDownloadResult =
  { status: "success"; source: LoadingScreenSource } | { status: "failed" };

/**
 * Download a single loading-screen image.
 *
 * Tries Riot's Data Dragon CDN first (canonical URL pattern). On any non-200
 * response (notably 403 for newer "tier" skins like Praetorian / Star Nemesis
 * / Blood Moon / Flora Fatalis, which Riot does not host on Data Dragon),
 * falls back to CommunityDragon's mirror — looked up via that champion's
 * `loadScreenPath` from `cdragon/v1/champions/{championId}.json`.
 *
 * Returns the source used so the caller can summarise + meter coverage.
 * Returns `failed` only when both sources fail; that's a real bug worth a
 * loud warning + non-zero exit.
 */
async function downloadLoadingScreenSkin(
  cdVersion: string,
  championName: string,
  championId: number,
  skinNum: number,
): Promise<LoadingScreenDownloadResult> {
  const outputPath = `${IMG_DIR}/champion-loading/${championName}_${String(skinNum)}.jpg`;

  // Tier 1: Data Dragon
  const ddragonUrl = `${BASE_URL}/cdn/img/champion/loading/${championName}_${String(skinNum)}.jpg`;
  try {
    const response = await fetchWithRetry(ddragonUrl);
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      await Bun.write(outputPath, buffer);
      assertFileSizeAtMost(
        outputPath,
        MAX_LOADING_SCREEN_IMAGE_BYTES,
        `Data Dragon loading screen ${championName}_${String(skinNum)}`,
      );
      return { status: "success", source: "ddragon" };
    }
  } catch {
    // Network error — fall through to CDragon
  }

  // Tier 2: CommunityDragon (resolve loadScreenPath for this skin)
  const cdragonChampion = await fetchCDragonChampion(cdVersion, championId);
  if (cdragonChampion === undefined) {
    return { status: "failed" };
  }
  // CommunityDragon `skin.id` follows championId * 1000 + skinNum (e.g. 9027
  // for Fiddlesticks Skin27, since Fiddlesticks championId = 9). Use that to
  // pick the right entry — it's more robust than fuzzy-matching skin names.
  const cdragonSkinId = championId * 1000 + skinNum;
  const skinEntry = cdragonChampion.skins.find((s) => s.id === cdragonSkinId);
  if (skinEntry?.loadScreenPath == null) {
    return { status: "failed" };
  }
  const cdragonUrl = resolveCDragonAssetUrl(
    cdVersion,
    skinEntry.loadScreenPath,
  );
  try {
    const response = await fetchWithRetry(cdragonUrl);
    if (!response.ok) {
      return { status: "failed" };
    }
    const buffer = await response.arrayBuffer();
    await Bun.write(outputPath, buffer);
    assertFileSizeAtMost(
      outputPath,
      MAX_LOADING_SCREEN_IMAGE_BYTES,
      `CommunityDragon loading screen ${championName}_${String(skinNum)}`,
    );
    return { status: "success", source: "cdragon" };
  } catch {
    return { status: "failed" };
  }
}

type LoadingScreenFailure = {
  championName: string;
  championId: number;
  skinNum: number;
};

/**
 * Re-attempt loading screens that failed BOTH sources on the first pass.
 *
 * A freshly-released patch frequently has a handful of new skins missing from
 * the Data Dragon CDN *and* CommunityDragon for a few minutes after release;
 * the first pass loses that race and would otherwise hard-fail the entire
 * refresh (exactly what failed the 2026-06-20 weekly run on patch 16.12.1 —
 * Renata 31 / Zed 69 were on both CDNs hours later). Each round drops the
 * cached CDragon champion JSON so Tier 2 re-resolves, waits out propagation,
 * then retries only the still-missing skins. Genuinely-missing assets still
 * fail after every round, preserving the loud hard-fail downstream.
 */
async function retryFailedLoadingScreens(
  cdVersion: string,
  failures: LoadingScreenFailure[],
  onSuccess: (
    failure: LoadingScreenFailure,
    source: "ddragon" | "cdragon",
  ) => void,
): Promise<LoadingScreenFailure[]> {
  const ROUNDS = 3;
  const DELAY_MS = 30_000;
  let pending = failures;
  for (let round = 1; round <= ROUNDS && pending.length > 0; round++) {
    console.warn(
      `\n⏳ ${String(pending.length)} loading screen(s) missing from both sources — retry ${String(round)}/${String(ROUNDS)} after ${String(DELAY_MS / 1000)}s (likely fresh-patch CDN propagation lag)...`,
    );
    await Bun.sleep(DELAY_MS);
    // Force Tier 2 to re-resolve: the champion JSON itself may have been absent.
    for (const failure of pending) {
      cdragonChampionCache.delete(
        `${cdVersion}:${failure.championId.toString()}`,
      );
    }
    const stillFailing: LoadingScreenFailure[] = [];
    for (const failure of pending) {
      const result = await downloadLoadingScreenSkin(
        cdVersion,
        failure.championName,
        failure.championId,
        failure.skinNum,
      );
      if (result.status === "success") {
        onSuccess(failure, result.source);
      } else {
        stillFailing.push(failure);
      }
    }
    pending = stillFailing;
  }
  return pending;
}

/**
 * Download champion loading screen art — base skin (skin 0) only.
 *
 * Only skin 0 is ever rendered: every report path resolves to the base skin,
 * so we no longer download the ~1,900 non-zero skins (or emit a champion→skin
 * map). Two-tier source resolution per champion:
 *   1. Data Dragon (`ddragon.leagueoflegends.com/cdn/img/champion/loading/...`)
 *   2. CommunityDragon (mirrors Riot's internal `lol-game-data` assets)
 *
 * If both sources fail for a champion, a loud warning is printed and the
 * function exits non-zero so CI catches it — silent data drift is exactly
 * what caused the original "no picture" bug.
 */
async function downloadChampionLoadingImages(
  cdVersion: string,
  championList: ChampionListData,
): Promise<{ imageCount: number }> {
  console.log("\nDownloading champion loading screen images (skin 0 only)...");

  const championEntries = Object.entries(championList.data);

  // Per-source counters for the summary
  let ddragonCount = 0;
  let cdragonCount = 0;
  // Champions whose base skin was sourced from CDragon (for the summary)
  const cdragonChampions: string[] = [];
  // Champions that failed BOTH sources on the first pass — retried below (fresh
  // patches lag both CDNs) before any of them count as a hard failure.
  const failedSkins: LoadingScreenFailure[] = [];

  for (const [championName, listEntry] of championEntries) {
    const championId = Number(listEntry.key);
    if (!Number.isSafeInteger(championId) || championId <= 0) {
      throw new Error(
        `Champion ${championName} has invalid championId ${listEntry.key}`,
      );
    }

    const result = await downloadLoadingScreenSkin(
      cdVersion,
      championName,
      championId,
      0,
    );
    if (result.status === "success") {
      if (result.source === "ddragon") {
        ddragonCount++;
      } else {
        cdragonCount++;
        cdragonChampions.push(championName);
      }
    } else {
      failedSkins.push({ championName, championId, skinNum: 0 });
    }
  }

  // Propagation-lag retry: give freshly-released champions a few more chances
  // on both CDNs before declaring them permanently missing. Whatever is still
  // missing afterward is a real failure that hard-throws below.
  const stillMissing = await retryFailedLoadingScreens(
    cdVersion,
    failedSkins,
    (failure, source) => {
      if (source === "ddragon") {
        ddragonCount++;
      } else {
        cdragonCount++;
        cdragonChampions.push(failure.championName);
      }
    },
  );
  const failedCount = stillMissing.length;

  // Summary
  console.log("");
  console.log("Loading screens by source:");
  console.log(`  ddragon: ${ddragonCount.toString().padStart(5)} skins`);
  console.log(
    `  cdragon: ${cdragonCount.toString().padStart(5)} skins  (Data Dragon CDN didn't have these — used CommunityDragon)`,
  );
  console.log(`  failed:  ${failedCount.toString().padStart(5)} skins`);

  if (cdragonChampions.length > 0) {
    console.log("");
    console.log(
      "CommunityDragon-sourced loading screens (Data Dragon CDN missing):",
    );
    for (const champion of cdragonChampions) {
      console.log(`  ${champion}`);
    }
  }

  if (failedCount > 0) {
    console.error("");
    console.error(
      "❌ Loading screens that failed BOTH sources (will not be on disk):",
    );
    for (const failure of stillMissing) {
      console.error(`  ${failure.championName}`);
    }
    console.error(
      `\n❌ ${failedCount.toString()} loading screen(s) could not be downloaded from either Data Dragon or CommunityDragon. Investigate before deploying.`,
    );
    throw new Error(
      `update-data-dragon: ${failedCount.toString()} loading screen(s) failed both Data Dragon and CommunityDragon`,
    );
  }

  const imageCount = ddragonCount + cdragonCount;
  console.log(
    `✓ Downloaded ${imageCount.toString()} champion loading images across ${championEntries.length.toString()} champions`,
  );
  return { imageCount };
}

type SplashSource = "cdragon" | "ddragon";

type SplashDownloadResult =
  { status: "success"; source: SplashSource } | { status: "failed" };

/**
 * Download a single champion splash-art image (base skin 0 in practice).
 *
 * Two-tier source resolution, mirroring `downloadLoadingScreenSkin` but with a
 * higher-resolution source order:
 *   1. CommunityDragon *centered* splash (≈1280×720), keyed by numeric champion
 *      id — the primary source because centered art stays framed when the ranked
 *      designs crop the wide splash.
 *   2. Data Dragon splash (≈1215×717), keyed by champion name.
 *
 * Both are ~4× the linear resolution of the loading-screen art the ranked
 * designs used before. Returns the source used so the caller can summarise
 * coverage; `failed` only when both sources fail.
 */
async function downloadSplashSkin(
  dataDragonVersion: string,
  championName: string,
  championId: number,
  skinNum: number,
): Promise<SplashDownloadResult> {
  const outputPath = `${IMG_DIR}/champion-splash/${championName}_${String(skinNum)}.jpg`;

  // Tier 1: CommunityDragon centered splash (by numeric champion id)
  const cdragonUrl = getCDragonCenteredSplashUrl(
    dataDragonVersion,
    championId,
    skinNum,
  );
  try {
    const response = await fetchWithRetry(cdragonUrl);
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      await Bun.write(outputPath, buffer);
      assertFileSizeAtMost(
        outputPath,
        MAX_SPLASH_IMAGE_BYTES,
        `CommunityDragon centered splash ${championName}_${String(skinNum)}`,
      );
      return { status: "success", source: "cdragon" };
    }
  } catch {
    // Network error — fall through to Data Dragon
  }

  // Tier 2: Data Dragon splash (by champion name)
  const ddragonUrl = `${BASE_URL}/cdn/img/champion/splash/${championName}_${String(skinNum)}.jpg`;
  try {
    const response = await fetchWithRetry(ddragonUrl);
    if (!response.ok) {
      return { status: "failed" };
    }
    const buffer = await response.arrayBuffer();
    await Bun.write(outputPath, buffer);
    assertFileSizeAtMost(
      outputPath,
      MAX_SPLASH_IMAGE_BYTES,
      `Data Dragon splash ${championName}_${String(skinNum)}`,
    );
    return { status: "success", source: "ddragon" };
  } catch {
    return { status: "failed" };
  }
}

type SplashFailure = {
  championName: string;
  championId: number;
  skinNum: number;
};

/**
 * Re-attempt splashes that failed BOTH sources on the first pass — same
 * fresh-patch CDN propagation-lag guard as `retryFailedLoadingScreens`.
 */
async function retryFailedSplashes(
  dataDragonVersion: string,
  failures: SplashFailure[],
  onSuccess: (failure: SplashFailure, source: SplashSource) => void,
): Promise<SplashFailure[]> {
  const ROUNDS = 3;
  const DELAY_MS = 30_000;
  let pending = failures;
  for (let round = 1; round <= ROUNDS && pending.length > 0; round++) {
    console.warn(
      `\n⏳ ${String(pending.length)} splash(es) missing from both sources — retry ${String(round)}/${String(ROUNDS)} after ${String(DELAY_MS / 1000)}s (likely fresh-patch CDN propagation lag)...`,
    );
    await Bun.sleep(DELAY_MS);
    const stillFailing: SplashFailure[] = [];
    for (const failure of pending) {
      const result = await downloadSplashSkin(
        dataDragonVersion,
        failure.championName,
        failure.championId,
        failure.skinNum,
      );
      if (result.status === "success") {
        onSuccess(failure, result.source);
      } else {
        stillFailing.push(failure);
      }
    }
    pending = stillFailing;
  }
  return pending;
}

/**
 * Download high-resolution champion splash art — **base skin 0 only**.
 *
 * The ranked-banner / ranked-square report designs render one full-bleed splash
 * (the hero champion, always skin 0), so only base-skin art is needed. Non-zero
 * skins fall back to `_0` at runtime (`getChampionSplashImageBase64`), and
 * skin-aware ranked art would only need this loop to iterate more skins.
 *
 * Hard-fails (non-zero exit) if any champion's splash is missing from both
 * sources after the propagation-lag retries — silent data drift is exactly what
 * caused the original loading-screen "no picture" bug.
 */
async function downloadChampionSplashImages(
  dataDragonVersion: string,
  championList: ChampionListData,
): Promise<{ imageCount: number }> {
  console.log("\nDownloading champion splash-art images (base skin 0)...");

  const championEntries = Object.entries(championList.data);
  let cdragonCount = 0;
  let ddragonCount = 0;
  // championName → skin nums sourced from Data Dragon (CDragon centered missing)
  const ddragonByChampion: Record<string, number[]> = {};
  const failedSkins: SplashFailure[] = [];

  for (const [championName, listEntry] of championEntries) {
    const championId = Number(listEntry.key);
    if (!Number.isSafeInteger(championId) || championId <= 0) {
      throw new Error(
        `Champion ${championName} has invalid championId ${listEntry.key}`,
      );
    }

    const result = await downloadSplashSkin(
      dataDragonVersion,
      championName,
      championId,
      0,
    );
    if (result.status === "success") {
      if (result.source === "cdragon") {
        cdragonCount++;
      } else {
        ddragonCount++;
        (ddragonByChampion[championName] ??= []).push(0);
      }
    } else {
      failedSkins.push({ championName, championId, skinNum: 0 });
    }
  }

  const stillMissing = await retryFailedSplashes(
    dataDragonVersion,
    failedSkins,
    (failure, source) => {
      if (source === "cdragon") {
        cdragonCount++;
      } else {
        ddragonCount++;
        (ddragonByChampion[failure.championName] ??= []).push(failure.skinNum);
      }
    },
  );

  // Summary
  console.log("");
  console.log("Splash art by source:");
  console.log(
    `  cdragon: ${cdragonCount.toString().padStart(5)} skins  (centered)`,
  );
  console.log(
    `  ddragon: ${ddragonCount.toString().padStart(5)} skins  (CommunityDragon centered missing — used Data Dragon)`,
  );
  console.log(`  failed:  ${stillMissing.length.toString().padStart(5)} skins`);

  if (Object.keys(ddragonByChampion).length > 0) {
    console.log("");
    console.log(
      "Data Dragon-sourced splashes (CommunityDragon centered missing):",
    );
    for (const [champion, skinNums] of Object.entries(ddragonByChampion)) {
      console.log(`  ${champion}: skins [${skinNums.join(",")}]`);
    }
  }

  if (stillMissing.length > 0) {
    console.error("");
    console.error(
      "❌ Splashes that failed BOTH sources (will not be on disk):",
    );
    for (const failure of stillMissing) {
      console.error(
        `  ${failure.championName}: skin ${String(failure.skinNum)}`,
      );
    }
    throw new Error(
      `update-data-dragon: ${stillMissing.length.toString()} splash(es) failed both CommunityDragon and Data Dragon`,
    );
  }

  const imageCount = cdragonCount + ddragonCount;
  console.log(
    `✓ Downloaded ${imageCount.toString()} champion splash images across ${championEntries.length.toString()} champions`,
  );
  return { imageCount };
}

async function downloadRuneImages(runes: RuneTreeData): Promise<number> {
  console.log("\nDownloading rune icons...");
  const runeImages: { url: string; path: string; name: string }[] = [];
  for (const tree of runes) {
    // Add tree icon
    const treeIconFilename =
      tree.icon.split("/").pop() ?? `tree_${String(tree.id)}.png`;
    runeImages.push({
      url: `https://ddragon.leagueoflegends.com/cdn/img/${tree.icon}`,
      path: `${IMG_DIR}/rune/${treeIconFilename}`,
      name: tree.name,
    });

    // Add all rune icons in the tree
    for (const slot of tree.slots) {
      for (const rune of slot.runes) {
        const runeIconFilename =
          rune.icon.split("/").pop() ?? `rune_${String(rune.id)}.png`;
        runeImages.push({
          url: `https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`,
          path: `${IMG_DIR}/rune/${runeIconFilename}`,
          name: rune.name,
        });
      }
    }
  }
  await downloadImagesInBatches(runeImages, 20);
  console.log(`✓ Downloaded ${String(runeImages.length)} rune images`);
  return runeImages.length;
}

const LANE_ICON_MAP: Record<string, string> = {
  top: "icon-position-top.png",
  jungle: "icon-position-jungle.png",
  middle: "icon-position-middle.png",
  adc: "icon-position-bottom.png",
  support: "icon-position-utility.png",
};

async function downloadLaneImages(positionsUrl: string): Promise<number> {
  console.log("\nDownloading lane position icons from CommunityDragon...");
  const laneImages = Object.entries(LANE_ICON_MAP).map(([lane, filename]) => ({
    url: `${positionsUrl}/${filename}`,
    path: `${IMG_DIR}/lane/${lane}.png`,
    name: lane,
  }));
  await downloadImagesInBatches(laneImages, 5);
  console.log(`✓ Downloaded ${String(laneImages.length)} lane position icons`);
  return laneImages.length;
}

async function fetchAndSaveArenaAugments(arenaAugmentsUrl: string): Promise<{
  iconPaths: Set<string>;
  count: number;
}> {
  console.log("\nFetching Arena augments from CommunityDragon...");

  const response = await fetchWithRetry(arenaAugmentsUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Arena augments: ${String(response.status)} ${response.statusText}`,
    );
  }

  const data: unknown = await response.json();
  const parsed = ArenaAugmentsApiResponseSchema.parse(data);

  // Build the cache format keyed by ID
  const cache: Record<string, ArenaAugmentCacheEntry> = {};
  const iconPaths = new Set<string>();

  for (const augment of parsed.augments) {
    iconPaths.add(augment.iconLarge);
    iconPaths.add(augment.iconSmall);

    cache[augment.id.toString()] = {
      id: augment.id,
      apiName: augment.apiName,
      name: augment.name,
      desc: augment.desc,
      tooltip: augment.tooltip,
      iconLarge: augment.iconLarge,
      iconSmall: augment.iconSmall,
      rarity: rarityNumberToString(augment.rarity),
      dataValues: augment.dataValues ?? {},
      calculations: augment.calculations ?? {},
      type: "full",
    };
  }

  // Write arena-augments.json
  await Bun.write(
    `${ASSETS_DIR}/arena-augments.json`,
    JSON.stringify(cache, null, 2),
  );
  console.log(
    `✓ Written arena-augments.json (${String(parsed.augments.length)} augments)`,
  );

  return { iconPaths, count: parsed.augments.length };
}

async function downloadAugmentImages(
  communityDragonUrl: string,
  arenaAugmentsUrl: string,
): Promise<number> {
  console.log("\nDownloading augment icons from CommunityDragon...");

  const { iconPaths } = await fetchAndSaveArenaAugments(arenaAugmentsUrl);

  const augmentImages = [...iconPaths].map((iconPath) => {
    const filename = iconPath.split("/").pop() ?? "unknown.png";
    return {
      url: `${communityDragonUrl}/${iconPath}`,
      path: `${IMG_DIR}/augment/${filename}`,
      name: filename,
    };
  });

  if (augmentImages.length > 0) {
    await downloadImagesInBatches(augmentImages, 10);
    console.log(`✓ Downloaded ${String(augmentImages.length)} augment images`);
    return augmentImages.length;
  } else {
    console.log("  No augment icons found");
    return 0;
  }
}

const VersionFileSchema = z.object({ version: z.string().min(1) });

/**
 * Read the version currently committed on disk, before this run overwrites it.
 * Returns undefined on a first-ever run or an unparseable file so the changelog
 * step simply no-ops rather than guessing.
 */
async function readPreviousVersion(): Promise<string | undefined> {
  const file = Bun.file(`${ASSETS_DIR}/version.json`);
  if (!(await file.exists())) {
    return undefined;
  }
  const data: unknown = await file.json();
  const parsed = VersionFileSchema.safeParse(data);
  return parsed.success ? parsed.data.version : undefined;
}

/**
 * Append a "What's New" entry to the frontend changelog — but only on a
 * minor-version bump (16.13.x → 16.14.x). Micro-bumps, unchanged weekly
 * refreshes, and first-ever runs skip it, so the auto-merged Data Dragon PR
 * never spams the changelog.
 *
 * The entry references the REAL player-facing patch number (e.g. "26.13") pulled
 * from Riot's patch-notes feed, not the Data Dragon version ("16.13"). A
 * network/parse failure throws (fail fast); a not-yet-posted matching patch is
 * an expected timing case that skips the entry without blocking the asset PR.
 */
/**
 * Archive the raw patch-notes page for provenance/re-analysis. Best-effort: a
 * fetch failure is logged and skipped (the structured changeset is what reviews
 * actually consume). Committed but excluded from formatting and never imported.
 */
async function saveRawPatchNotes(
  patch: RiotPatch,
  officialPatchContent: string,
): Promise<void> {
  await Bun.write(
    `${PATCH_NOTES_ARCHIVE_DIR}/${patch.patch}.html`,
    officialPatchContent,
  );
  console.log(`✓ Archived raw patch ${patch.patch} notes`);
}

async function maybeAppendChangelogEntry(
  previousVersion: string | undefined,
  version: string,
): Promise<void> {
  if (previousVersion === undefined) {
    console.log("\nℹ No previous version.json — skipping changelog entry");
    return;
  }
  if (!isMinorVersionBump(previousVersion, version)) {
    console.log(
      `\nℹ ${previousVersion} → ${version} is not a minor bump — skipping changelog entry`,
    );
    return;
  }

  const minor = Number(minorVersionKey(version).split(".")[1]);
  console.log(
    `\n📝 Resolving Riot patch notes for Data Dragon ${version} (minor .${String(minor)})...`,
  );
  const patches = await fetchPatches();
  const patch = selectPatchByMinor(patches, minor);
  if (patch === undefined) {
    // Riot hasn't posted the matching patch yet (Data Dragon led the news).
    // Expected timing, not a failure: skip the entry; the assets still update
    // and a later run adds it once the notes are live.
    console.warn(
      `\n⚠ Riot has not posted patch notes for .${String(minor)} yet (latest: ${patches[0]?.patch ?? "unknown"}). Skipping changelog entry; assets still updated.`,
    );
    return;
  }

  // Ask Opus through OpenRouter to analyze deterministically fetched patch notes
  // (`summary` + per-change data feed the AI review) plus the Scout-focused
  // `changelogHighlights` consumed here for the "What's New" entry.
  // Best-effort: a failure (no credential, timeout, bad output) falls back to just
  // the data-refresh line and leaves the committed changeset untouched, rather
  // than blocking the asset PR or shipping a garbage changeset.
  let highlights: string[] = [];
  try {
    console.log(
      `🤖 Analyzing patch ${patch.patch} notes via OpenRouter Opus...`,
    );
    const officialPatchContent = await fetchOfficialPatchNotes(patch);
    const changeset = await analyzePatch(patch, officialPatchContent);
    await Bun.write(
      PATCH_NOTES_ASSET,
      `${JSON.stringify(changeset, null, 2)}\n`,
    );
    const prettierResult =
      await $`cd ${MONOREPO_ROOT} && bunx prettier --write ${PATCH_NOTES_ASSET}`.quiet();
    if (prettierResult.exitCode !== 0) {
      throw new Error(
        `prettier failed to format patch-notes.json (exit ${String(prettierResult.exitCode)}): ${prettierResult.stderr.toString()}`,
      );
    }
    console.log(
      `✓ Wrote patch changeset (${String(changeset.champions.length)} champion, ${String(changeset.items.length)} item, ${String(changeset.systems.length)} system changes)`,
    );
    highlights = changeset.changelogHighlights;
    await saveRawPatchNotes(patch, officialPatchContent);
  } catch (error) {
    console.warn(
      `⚠ OpenRouter patch analysis failed; using data-refresh line only and leaving patch-notes.json unchanged: ${String(error)}`,
    );
  }

  console.log(
    `📝 Adding "What's New" entry for League patch ${patch.patch}...`,
  );
  const source = await Bun.file(CHANGELOG_FILE).text();
  const updated = insertChangelogEntry(
    source,
    buildPatchChangelogEntryLiteral(patch, highlights, new Date()),
  );
  await Bun.write(CHANGELOG_FILE, updated);

  // The prettier gate covers changelog.tsx, so format the edit before commit or
  // the auto-merged PR fails CI. Resolve prettier from the monorepo root.
  const result =
    await $`cd ${MONOREPO_ROOT} && bunx prettier --write ${CHANGELOG_FILE}`.quiet();
  if (result.exitCode !== 0) {
    throw new Error(
      `prettier failed to format changelog.tsx (exit ${String(result.exitCode)}): ${result.stderr.toString()}`,
    );
  }
  console.log(`✓ Added changelog entry for League patch ${patch.patch}`);
}

async function main(): Promise<void> {
  try {
    const requestedVersion = process.argv.find((argument) =>
      /^\d+\.\d+\.\d+$/.test(argument),
    );
    if (process.argv.includes("--classic-assets-only")) {
      const previousVersion = await readPreviousVersion();
      if (previousVersion === undefined) {
        throw new Error("--classic-assets-only requires a Data Dragon version");
      }
      if (
        requestedVersion !== undefined &&
        requestedVersion !== previousVersion
      ) {
        throw new Error(
          `--classic-assets-only must use the committed Data Dragon version ${previousVersion}; received ${requestedVersion}`,
        );
      }
      const version = previousVersion;
      const cdVersion = getCommunityDragonVersion(version);
      await createDirectories();
      await downloadClassicBackground(cdVersion);
      const { championList, discoveries } = await fetchChampionList(
        version,
        cdVersion,
      );
      await downloadClassicChampionAssets(
        version,
        cdVersion,
        championList,
        discoveries,
      );
      await $`cd ${MONOREPO_ROOT} && bun run --cwd packages/scout-for-lol/packages/data generate:asset-manifest --write`;
      return;
    }
    // --ability-facts-only regenerates just assets/ability-facts/ from the
    // committed Data Dragon champion files + live CommunityDragon bins,
    // pinned to the committed version so facts and assets stay in lockstep.
    if (process.argv.includes("--ability-facts-only")) {
      const previousVersion = await readPreviousVersion();
      if (previousVersion === undefined) {
        throw new Error(
          "--ability-facts-only requires a committed version.json",
        );
      }
      if (
        requestedVersion !== undefined &&
        requestedVersion !== previousVersion
      ) {
        throw new Error(
          `--ability-facts-only must use the committed Data Dragon version ${previousVersion}; received ${requestedVersion}`,
        );
      }
      const cdVersion = getCommunityDragonVersion(previousVersion);
      await ensureDir(`${ASSETS_DIR}/ability-facts`);
      const committedChampionList: unknown = await Bun.file(
        `${ASSETS_DIR}/champion.json`,
      ).json();
      const championNames = Object.values(
        ChampionListSchema.parse(committedChampionList).data,
      )
        .filter((entry) => !entry.id.startsWith("Jade_"))
        .map((entry) => entry.id);
      await generateAbilityFacts(cdVersion, championNames);
      return;
    }
    // --snapshots-only skips version resolution + asset download and jumps
    // straight to the install-refresh + snapshot-test step, against
    // whatever Data Dragon assets are already committed in the tree. Used by
    // the temporal-schedule-rehearsal CI canary to exercise the exact step
    // that broke scout-data-dragon-weekly-refresh without a network fetch or
    // a real version bump.
    if (process.argv.includes("--snapshots-only")) {
      console.log("\n📸 Updating snapshots (--snapshots-only)...");
      await updateSnapshots();
      console.log("✅ Snapshots updated");
      return;
    }

    // Get version from command line or fetch latest
    const version = requestedVersion ?? (await getLatestVersion());
    // Capture the on-disk version BEFORE writeJsonAssets overwrites it so the
    // changelog step can detect a minor-version bump.
    const previousVersion = await readPreviousVersion();
    const cdVersion = getCommunityDragonVersion(version);
    const communityDragonUrl = getCommunityDragonUrl(cdVersion);
    const communityDragonPositionsUrl =
      getCommunityDragonPositionsUrl(cdVersion);
    const arenaAugmentsUrl = getArenaAugmentsUrl(cdVersion);
    console.log(
      `\nUsing Data Dragon version: ${version} (CommunityDragon: ${cdVersion})\n`,
    );

    // Ensure directories exist
    await createDirectories();
    await downloadClassicBackground(cdVersion);

    // Download and validate each asset
    const summoner = await downloadAsset(
      version,
      "summoner.json",
      SummonerSchema,
    );
    const items = await downloadAsset(version, "item.json", ItemSchema);
    const runes = await downloadAsset(
      version,
      "runesReforged.json",
      RuneTreeSchema,
    );

    // Write JSON assets to disk
    await writeJsonAssets(summoner, items, runes, version);

    // Download champion list (also writes champion.json)
    const { championList, discoveries } = await fetchChampionList(
      version,
      cdVersion,
    );
    const championNames = Object.values(championList.data)
      .filter((entry) => !entry.id.startsWith("Jade_"))
      .map((entry) => entry.id);

    // Download all images
    const spellImagesCount = await downloadSummonerSpellImages(
      version,
      summoner,
    );
    const itemImagesCount = await downloadItemImages(version, items);
    const championImagesCount = await downloadChampionImages(
      version,
      championNames,
    );
    const championDataCount = await downloadChampionData(
      version,
      championNames,
    );
    // Must run after downloadChampionData: reads the freshly written
    // assets/champion/{Key}.json files.
    await generateAbilityFacts(cdVersion, championNames);
    const runeImagesCount = await downloadRuneImages(runes);
    const augmentImagesCount = await downloadAugmentImages(
      communityDragonUrl,
      arenaAugmentsUrl,
    );
    const laneImagesCount = await downloadLaneImages(
      communityDragonPositionsUrl,
    );

    // Download champion loading screen images (skin 0 only) — must run after champion data
    const { imageCount: loadingImagesCount } =
      await downloadChampionLoadingImages(cdVersion, {
        data: Object.fromEntries(
          Object.entries(championList.data).filter(
            ([, entry]) => !entry.id.startsWith("Jade_"),
          ),
        ),
      });

    // Download high-res champion splash art (base skin 0) for the ranked
    // report designs — keyed by champion id/name, no champion-data dependency.
    const { imageCount: splashImagesCount } =
      await downloadChampionSplashImages(version, {
        data: Object.fromEntries(
          Object.entries(championList.data).filter(
            ([, entry]) => !entry.id.startsWith("Jade_"),
          ),
        ),
      });
    const classicImagesCount = await downloadClassicChampionAssets(
      version,
      cdVersion,
      championList,
      discoveries,
    );
    await $`cd ${MONOREPO_ROOT} && bun run --cwd packages/scout-for-lol/packages/data generate:asset-manifest --write`;

    const totalImages =
      spellImagesCount +
      itemImagesCount +
      championImagesCount +
      runeImagesCount +
      augmentImagesCount +
      laneImagesCount +
      loadingImagesCount +
      splashImagesCount +
      classicImagesCount;
    console.log(
      `\n✅ Successfully updated Data Dragon assets to version ${version}`,
    );
    console.log(`\nAssets written to: ${ASSETS_DIR}`);
    console.log(`Total images downloaded: ${String(totalImages)}`);
    console.log(`  - ${String(spellImagesCount)} summoner spell images`);
    console.log(`  - ${String(itemImagesCount)} item images`);
    console.log(`  - ${String(championImagesCount)} champion portrait images`);
    console.log(
      `  - ${String(loadingImagesCount)} champion loading screen images`,
    );
    console.log(
      `  - ${String(splashImagesCount)} champion splash-art images (skin 0)`,
    );
    console.log(
      `  - ${String(classicImagesCount)} League Classic champion asset sets`,
    );
    console.log(`  - ${String(runeImagesCount)} rune images`);
    console.log(`  - ${String(augmentImagesCount)} augment images`);
    console.log(`  - ${String(laneImagesCount)} lane position icons`);
    console.log(
      `  - ${String(championDataCount)} champion data files (abilities/passives)`,
    );

    // Update snapshots that depend on Data Dragon data
    console.log("\n📸 Updating snapshots...");
    await updateSnapshots();
    console.log("✅ Snapshots updated");

    // Add a "What's New" entry to the marketing site on minor-version bumps.
    await maybeAppendChangelogEntry(previousVersion, version);
  } catch (error) {
    console.error("\n❌ Error updating Data Dragon assets:");
    console.error(error);
    process.exit(1);
  }
}

async function updateSnapshots(): Promise<void> {
  const scoutRoot = `${import.meta.dir}/../../..`;

  // NO install refresh here, deliberately. This used to run a second root
  // `bun install --force` to defeat the content-hashed COPY the linker made at
  // `node_modules/.bun/@scout-for-lol+data@…`, which otherwise served snapshot
  // tests stale assets after Riot renamed an icon (PhaseRush.png →
  // StormraidersSurgeRuneIcon2.png in DDragon 16.9.1).
  //
  // The isolated-linker migration removed that copy: workspace packages are now
  // plain symlinks to source (`backend/node_modules/@scout-for-lol/data ->
  // ../../../data`, nothing under `node_modules/.bun/`), and assets resolve via
  // `new URL(path, import.meta.url)`, which follows the symlink into the tree
  // this script just wrote. Freshly-downloaded assets are already live.
  //
  // The refresh was not merely redundant — `bun install --force` means "request
  // the latest versions from the registry", so it re-resolved dependencies and
  // dirtied `bun.lock`, which the Data Dragon allowlist rejects. That failed
  // every scheduled run from 2026-08-12.

  // Snapshots that depend on Data Dragon data
  const snapshotTests = [
    // Report package snapshots
    {
      cwd: `${scoutRoot}/packages/report`,
      tests: [
        "src/dataDragon/__snapshots__/summoner.test.ts",
        "src/dataDragon/__snapshots__/version.test.ts",
        "src/html/arena/__snapshots__/realdata.integration.test.ts",
        "src/html/ranked-banner/banner.integration.test.ts",
        "src/html/ranked-square/square.integration.test.ts",
      ],
    },
    // Backend package snapshots
    {
      cwd: `${scoutRoot}/packages/backend`,
      tests: ["src/league/model/__tests__/arena.realdata.integration.test.ts"],
    },
  ];

  for (const { cwd, tests } of snapshotTests) {
    for (const testPath of tests) {
      // Extract the test file path from snapshot path
      const testFile = testPath.includes("__snapshots__")
        ? testPath.replace("__snapshots__/", "").replace(".snap", "")
        : testPath;

      console.log(`  Updating: ${testFile}`);
      const result = await $`cd ${cwd} && bun run test -- ${testFile} --update`
        .quiet()
        .nothrow();
      assertSnapshotUpdateSucceeded(
        testFile,
        result.exitCode,
        result.stderr.toString(),
      );
    }
  }
}

export function assertSnapshotUpdateSucceeded(
  testFile: string,
  exitCode: number,
  stderr: string,
): void {
  if (exitCode === 0) {
    return;
  }

  throw new Error(
    `Snapshot update failed for ${testFile} (exit ${String(exitCode)}): ${stderr}`,
  );
}

if (import.meta.main) {
  void main();
}
