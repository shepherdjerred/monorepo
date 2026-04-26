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
  ChampionDetailSkinsSchema,
  CDragonChampionSchema,
  rarityNumberToString,
  type SummonerData,
  type ItemData,
  type RuneTreeData,
  type ArenaAugmentCacheEntry,
  type ChampionListData,
  type CDragonChampion,
} from "./update-data-dragon-schemas.ts";
import { getChampionName } from "twisted/dist/constants/champions.js";

const ASSETS_DIR = `${import.meta.dir}/../src/data-dragon/assets`;
const IMG_DIR = `${ASSETS_DIR}/img`;
const BASE_URL = "https://ddragon.leagueoflegends.com";

function getCommunityDragonVersion(dataDragonVersion: string): string {
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

const CDRAGON_LOL_GAME_DATA_BASE = `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default`;

function getCDragonChampionJsonUrl(championId: number): string {
  return `${CDRAGON_LOL_GAME_DATA_BASE}/v1/champions/${championId.toString()}.json`;
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
export function resolveCDragonAssetUrl(loadScreenPath: string): string {
  const lowered = loadScreenPath.toLowerCase();
  const stripped = lowered.startsWith("/lol-game-data/assets")
    ? lowered.slice("/lol-game-data/assets".length)
    : lowered;
  return `${CDRAGON_LOL_GAME_DATA_BASE}${stripped}`;
}

const cdragonChampionCache = new Map<number, CDragonChampion | undefined>();

/**
 * Fetch (and cache) the CommunityDragon per-champion JSON. Returns `undefined`
 * if the lookup fails — callers must treat that as "no fallback available".
 */
async function fetchCDragonChampion(
  championId: number,
): Promise<CDragonChampion | undefined> {
  if (cdragonChampionCache.has(championId)) {
    return cdragonChampionCache.get(championId);
  }
  try {
    const response = await fetch(getCDragonChampionJsonUrl(championId));
    if (!response.ok) {
      cdragonChampionCache.set(championId, undefined);
      return undefined;
    }
    const data: unknown = await response.json();
    const parsed = CDragonChampionSchema.parse(data);
    cdragonChampionCache.set(championId, parsed);
    return parsed;
  } catch {
    cdragonChampionCache.set(championId, undefined);
    return undefined;
  }
}

async function ensureDir(path: string): Promise<void> {
  await $`mkdir -p ${path}`;
}

async function getLatestVersion(): Promise<string> {
  console.log("Fetching latest version...");
  const response = await fetch(`${BASE_URL}/api/versions.json`);
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

  const response = await fetch(url);
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
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image ${url}: ${String(response.status)}`);
  }
  const buffer = await response.arrayBuffer();
  await Bun.write(outputPath, buffer);
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
  await ensureDir(`${ASSETS_DIR}/champion`);
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

async function fetchChampionList(version: string): Promise<ChampionListData> {
  console.log("\nFetching champion list...");
  const championListUrl = `${BASE_URL}/cdn/${version}/data/en_US/champion.json`;
  const championListResponse = await fetch(championListUrl);
  const data: unknown = await championListResponse.json();
  const championListData = ChampionListSchema.parse(data);
  const championNames = Object.keys(championListData.data);
  console.log(`Found ${String(championNames.length)} champions`);

  await Bun.write(
    `${ASSETS_DIR}/champion.json`,
    JSON.stringify(championListData, null, 2),
  );
  console.log("✓ Written champion.json");

  return championListData;
}

// PascalCase a Twisted SCREAMING_SNAKE_CASE name: "LEE_SIN" → "LeeSin",
// "REKSAI" → "Reksai". Mirrors `resolveChampionKey` in packages/backend.
function pascalCaseTwistedName(rawName: string): string {
  return rawName
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

async function generateChampionOverrides(
  championList: ChampionListData,
): Promise<number> {
  console.log("\nGenerating championNameOverrides.generated.ts...");

  const overrides: Record<string, string> = {};
  const twistedMisses: string[] = [];
  for (const entry of Object.values(championList.data)) {
    const numericId = Number(entry.key);
    if (!Number.isFinite(numericId)) {
      continue;
    }
    // Twisted lags Data Dragon on new releases — skip unknowns so the
    // override map stays current for every champion Twisted does know.
    // A still-missing champion will surface loudly in the P2 startup
    // validator once Twisted catches up.
    let rawName: string;
    try {
      rawName = getChampionName(numericId);
    } catch {
      twistedMisses.push(`${entry.id} (id ${entry.key})`);
      continue;
    }
    if (!rawName || rawName === "") {
      twistedMisses.push(`${entry.id} (id ${entry.key})`);
      continue;
    }
    const pascalCased = pascalCaseTwistedName(rawName);
    if (pascalCased !== entry.id) {
      overrides[pascalCased] = entry.id;
    }
  }

  if (twistedMisses.length > 0) {
    console.warn(
      `  ⚠ Twisted does not recognize ${String(twistedMisses.length)} champion(s): ${twistedMisses.join(", ")}. Bump twisted to pick them up.`,
    );
  }

  const sortedKeys = Object.keys(overrides).toSorted();
  const mapBody = sortedKeys
    .map((key) => `  ${key}: ${JSON.stringify(overrides[key])},`)
    .join("\n");

  const fileContents = `// AUTO-GENERATED by packages/data/scripts/update-data-dragon.ts.
// Do not edit by hand — rerun \`bun run update-data-dragon\` to regenerate.
//
// Maps PascalCased Twisted output (\`resolveChampionKey\`) to the actual
// Data Dragon filename key when they differ. Every entry means Twisted and
// Data Dragon disagree about a champion's canonical name for the current
// asset version.

export const championNameOverrides: Record<string, string> = {
${mapBody}
};
`;

  await Bun.write(
    `${import.meta.dir}/../src/data-dragon/champion-name-overrides.generated.ts`,
    fileContents,
  );
  console.log(
    `✓ Generated ${String(sortedKeys.length)} championNameOverrides entries`,
  );
  return sortedKeys.length;
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
      const response = await fetch(url);
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

type LoadingScreenSource = "ddragon" | "cdragon";

type LoadingScreenDownloadResult =
  | { status: "success"; source: LoadingScreenSource }
  | { status: "failed" };

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
  championName: string,
  championId: number,
  skinNum: number,
): Promise<LoadingScreenDownloadResult> {
  const outputPath = `${IMG_DIR}/champion-loading/${championName}_${String(skinNum)}.jpg`;

  // Tier 1: Data Dragon
  const ddragonUrl = `${BASE_URL}/cdn/img/champion/loading/${championName}_${String(skinNum)}.jpg`;
  try {
    const response = await fetch(ddragonUrl);
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      await Bun.write(outputPath, buffer);
      return { status: "success", source: "ddragon" };
    }
  } catch {
    // Network error — fall through to CDragon
  }

  // Tier 2: CommunityDragon (resolve loadScreenPath for this skin)
  const cdragonChampion = await fetchCDragonChampion(championId);
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
  const cdragonUrl = resolveCDragonAssetUrl(skinEntry.loadScreenPath);
  try {
    const response = await fetch(cdragonUrl);
    if (!response.ok) {
      return { status: "failed" };
    }
    const buffer = await response.arrayBuffer();
    await Bun.write(outputPath, buffer);
    return { status: "success", source: "cdragon" };
  } catch {
    return { status: "failed" };
  }
}

/**
 * Download champion loading screen art for all skins (excluding chromas) and
 * generate `champion-skins.json` mapping champion → valid skin numbers.
 *
 * Two-tier source resolution per skin:
 *   1. Data Dragon (`ddragon.leagueoflegends.com/cdn/img/champion/loading/...`)
 *   2. CommunityDragon (mirrors Riot's internal `lol-game-data` assets)
 *
 * If both sources fail, the skin is **excluded** from `baseSkins` (so the
 * runtime never tries to load it) and a loud per-champion warning is printed.
 * The function then exits non-zero so CI catches it — silent data drift is
 * exactly what caused the original "no picture" bug.
 */
async function downloadChampionLoadingImages(
  championList: ChampionListData,
): Promise<{ imageCount: number; skinMapCount: number }> {
  console.log("\nDownloading champion loading screen images...");

  const championEntries = Object.entries(championList.data);

  // baseSkins: champion → skin nums whose loading-screen JPG is on disk
  const baseSkins: Record<string, number[]> = {};
  // chromaToParent: champion → { chromaNum → parentSkinNum }
  const chromaToParent: Record<string, Record<string, number>> = {};
  // Per-source counters for the summary
  let ddragonCount = 0;
  let cdragonCount = 0;
  let failedCount = 0;
  // championName → list of skinNums sourced from CDragon (for the summary)
  const cdragonByChampion: Record<string, number[]> = {};
  // championName → list of skinNums where both sources failed (loud warn)
  const failedByChampion: Record<string, number[]> = {};

  for (const [championName, listEntry] of championEntries) {
    let intendedSkins: number[] = [];
    const chromaMap: Record<string, number> = {};

    try {
      const championFilePath = `${ASSETS_DIR}/champion/${championName}.json`;
      const fileContent = await Bun.file(championFilePath).text();
      const data = ChampionDetailSkinsSchema.parse(JSON.parse(fileContent));
      const championData = data.data[championName];
      if (!championData) {
        console.warn(
          `  ⚠ No champion data found for ${championName} in detail JSON`,
        );
        continue;
      }
      for (const skin of championData.skins) {
        if (skin.parentSkin === undefined) {
          intendedSkins.push(skin.num);
        } else {
          chromaMap[String(skin.num)] = skin.parentSkin;
        }
      }
    } catch (error) {
      console.warn(
        `  ⚠ Failed to parse skins for ${championName}: ${String(error)} — falling back to skin 0 only`,
      );
      intendedSkins = [0];
    }

    const championId = Number(listEntry.key);
    if (!Number.isFinite(championId)) {
      console.warn(
        `  ⚠ Champion ${championName} has invalid championId ${listEntry.key} — skipping`,
      );
      continue;
    }

    const downloadedSkins: number[] = [];
    for (const skinNum of intendedSkins) {
      const result = await downloadLoadingScreenSkin(
        championName,
        championId,
        skinNum,
      );
      if (result.status === "success") {
        downloadedSkins.push(skinNum);
        if (result.source === "ddragon") {
          ddragonCount++;
        } else {
          cdragonCount++;
          (cdragonByChampion[championName] ??= []).push(skinNum);
        }
      } else {
        failedCount++;
        (failedByChampion[championName] ??= []).push(skinNum);
      }
    }

    baseSkins[championName] = downloadedSkins;
    if (Object.keys(chromaMap).length > 0) {
      chromaToParent[championName] = chromaMap;
    }
  }

  // Write champion-skins.json — contents reflect what's actually on disk
  const skinsData = { baseSkins, chromaToParent };
  await Bun.write(
    `${ASSETS_DIR}/champion-skins.json`,
    JSON.stringify(skinsData, null, 2),
  );
  console.log(`✓ Written champion-skins.json`);

  // Summary
  console.log("");
  console.log("Loading screens by source:");
  console.log(`  ddragon: ${ddragonCount.toString().padStart(5)} skins`);
  console.log(
    `  cdragon: ${cdragonCount.toString().padStart(5)} skins  (Data Dragon CDN didn't have these — used CommunityDragon)`,
  );
  console.log(`  failed:  ${failedCount.toString().padStart(5)} skins`);

  if (Object.keys(cdragonByChampion).length > 0) {
    console.log("");
    console.log(
      "CommunityDragon-sourced loading screens (Data Dragon CDN missing):",
    );
    for (const [champion, skinNums] of Object.entries(cdragonByChampion)) {
      console.log(`  ${champion}: skins [${skinNums.join(",")}]`);
    }
  }

  if (failedCount > 0) {
    console.error("");
    console.error(
      "❌ Loading screens that failed BOTH sources (will not be on disk):",
    );
    for (const [champion, skinNums] of Object.entries(failedByChampion)) {
      console.error(`  ${champion}: skins [${skinNums.join(",")}]`);
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
  return { imageCount, skinMapCount: championEntries.length };
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

  const response = await fetch(arenaAugmentsUrl);
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

async function main(): Promise<void> {
  try {
    // Get version from command line or fetch latest
    const version = process.argv[2] ?? (await getLatestVersion());
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
    const championList = await fetchChampionList(version);
    const championNames = Object.keys(championList.data);

    // Regenerate championNameOverrides.generated.ts to catch drift between
    // Twisted's PascalCased output and Data Dragon's on-disk filenames.
    await generateChampionOverrides(championList);

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
    const runeImagesCount = await downloadRuneImages(runes);
    const augmentImagesCount = await downloadAugmentImages(
      communityDragonUrl,
      arenaAugmentsUrl,
    );
    const laneImagesCount = await downloadLaneImages(
      communityDragonPositionsUrl,
    );

    // Download champion loading screen images (all skins) — must run after champion data
    const { imageCount: loadingImagesCount } =
      await downloadChampionLoadingImages(championList);

    const totalImages =
      spellImagesCount +
      itemImagesCount +
      championImagesCount +
      runeImagesCount +
      augmentImagesCount +
      laneImagesCount +
      loadingImagesCount;
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
  } catch (error) {
    console.error("\n❌ Error updating Data Dragon assets:");
    console.error(error);
    process.exit(1);
  }
}

async function updateSnapshots(): Promise<void> {
  const rootDir = `${import.meta.dir}/../../..`;

  // Snapshots that depend on Data Dragon data
  const snapshotTests = [
    // Report package snapshots
    {
      cwd: `${rootDir}/packages/report`,
      tests: [
        "src/dataDragon/__snapshots__/summoner.test.ts",
        "src/dataDragon/__snapshots__/version.test.ts",
        "src/html/arena/__snapshots__/realdata.integration.test.ts",
      ],
    },
    // Backend package snapshots
    {
      cwd: `${rootDir}/packages/backend`,
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
      const result =
        await $`cd ${cwd} && bun test --update-snapshots ${testFile}`.quiet();
      if (result.exitCode !== 0) {
        console.warn(
          `    ⚠ Warning: snapshot update had non-zero exit code for ${testFile}`,
        );
      }
    }
  }
}

if (import.meta.main) {
  void main();
}
