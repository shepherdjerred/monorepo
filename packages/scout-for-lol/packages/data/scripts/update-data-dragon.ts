#!/usr/bin/env bun
import { z } from "zod";
import { first } from "remeda";
import { $ } from "bun";
import {
  SummonerSchema,
  ItemSchema,
  RuneTreeSchema,
  ChampionListSchema,
  ArenaAugmentsApiResponseSchema,
  rarityNumberToString,
  type SummonerData,
  type ItemData,
  type RuneTreeData,
  type ArenaAugmentCacheEntry,
} from "./update-data-dragon-schemas.ts";

const ASSETS_DIR = `${import.meta.dir}/../src/data-dragon/assets`;
const IMG_DIR = `${ASSETS_DIR}/img`;
const BASE_URL = "https://ddragon.leagueoflegends.com";
const COMMUNITY_DRAGON_URL = "https://raw.communitydragon.org/latest/game";

async function ensureDir(path: string): Promise<void> {
  await $`mkdir -p ${path}`;
}

async function getLatestVersion(): Promise<string> {
  console.log("Fetching latest version...");
  const response = await fetch(`${BASE_URL}/api/versions.json`);
  const data: unknown = await response.json();
  const versions = z.array(z.string()).parse(data);
  const latestVersion = first(versions);
  if (!latestVersion) {
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

async function getChampionNames(version: string): Promise<string[]> {
  console.log("\nFetching champion list...");
  const championListUrl = `${BASE_URL}/cdn/${version}/data/en_US/champion.json`;
  const championListResponse = await fetch(championListUrl);
  const data: unknown = await championListResponse.json();
  const championListData = ChampionListSchema.parse(data);
  const championNames = Object.keys(championListData.data);
  console.log(`Found ${String(championNames.length)} champions`);
  return championNames;
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

const ARENA_AUGMENTS_URL =
  "https://raw.communitydragon.org/latest/cdragon/arena/en_us.json";

async function fetchAndSaveArenaAugments(): Promise<{
  iconPaths: Set<string>;
  count: number;
}> {
  console.log("\nFetching Arena augments from CommunityDragon...");

  const response = await fetch(ARENA_AUGMENTS_URL);
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

async function downloadAugmentImages(): Promise<number> {
  console.log("\nDownloading augment icons from CommunityDragon...");

  const { iconPaths } = await fetchAndSaveArenaAugments();

  const augmentImages = Array.from(iconPaths).map((iconPath) => {
    const filename = iconPath.split("/").pop() ?? "unknown.png";
    return {
      url: `${COMMUNITY_DRAGON_URL}/${iconPath}`,
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
    console.log(`\nUsing Data Dragon version: ${version}\n`);

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

    // Download champion list
    const championNames = await getChampionNames(version);

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
    const augmentImagesCount = await downloadAugmentImages();

    const totalImages =
      spellImagesCount +
      itemImagesCount +
      championImagesCount +
      runeImagesCount +
      augmentImagesCount;
    console.log(
      `\n✅ Successfully updated Data Dragon assets to version ${version}`,
    );
    console.log(`\nAssets written to: ${ASSETS_DIR}`);
    console.log(`Total images downloaded: ${String(totalImages)}`);
    console.log(`  - ${String(spellImagesCount)} summoner spell images`);
    console.log(`  - ${String(itemImagesCount)} item images`);
    console.log(`  - ${String(championImagesCount)} champion portrait images`);
    console.log(`  - ${String(runeImagesCount)} rune images`);
    console.log(`  - ${String(augmentImagesCount)} augment images`);
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

void main();
