import type { Lane } from "#src/model/lane.ts";
import { latestVersion } from "./version.ts";
import {
  getChampionById,
  getChampionByKey,
  getChampionDisplayName as getChampionDisplayNameFromRegistry,
  normalizeChampionName,
} from "#src/model/champion-registry.ts";

export function getChampionKeyById(championId: number): string | undefined {
  return getChampionById(championId)?.key;
}

export function championNameToDisplayName(championName: string): string {
  const normalized = normalizeChampionName(championName);
  const numericId = Number(championName);
  const entry =
    getChampionByKey(normalized) ??
    (Number.isFinite(numericId) ? getChampionById(numericId) : undefined);
  if (entry) return entry.name;
  return normalized;
}

export function getChampionDisplayNameById(championId: number): string {
  return getChampionDisplayNameFromRegistry(championId);
}

function getAbsolutePath(relativePath: string): string {
  return new URL(relativePath, import.meta.url).pathname;
}

async function validateImageExists(
  absolutePath: string,
  description: string,
): Promise<void> {
  const file = Bun.file(absolutePath);
  const exists = await file.exists();

  if (!exists) {
    throw new Error(
      `${description} not found at ${absolutePath}. Run 'bun run update-data-dragon' in packages/data to cache latest assets.`,
    );
  }
}

// Helper function to load an image as base64 data URI
async function loadImageAsBase64(
  relativePath: string,
  mimeType: string,
): Promise<string> {
  const absolutePath = getAbsolutePath(relativePath);
  const file = Bun.file(absolutePath);
  const exists = await file.exists();

  if (!exists) {
    throw new Error(
      `Image not found at ${absolutePath}. Run 'bun run update-data-dragon' in packages/data to cache latest assets.`,
    );
  }

  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

// Validation functions (async, for preloading/checking)
export async function validateChampionImage(
  championName: string,
): Promise<void> {
  const normalized = normalizeChampionName(championName);
  const relativePath = `./assets/img/champion/${normalized}.png`;
  const absolutePath = getAbsolutePath(relativePath);
  await validateImageExists(absolutePath, `Champion image for ${normalized}`);
}

export async function validateItemImage(itemId: number): Promise<void> {
  const relativePath = `./assets/img/item/${itemId.toString()}.png`;
  const absolutePath = getAbsolutePath(relativePath);
  await validateImageExists(
    absolutePath,
    `Item image for item ${itemId.toString()}`,
  );
}

export async function validateSpellImage(
  spellImageName: string,
): Promise<void> {
  const relativePath = `./assets/img/spell/${spellImageName}`;
  const absolutePath = getAbsolutePath(relativePath);
  await validateImageExists(
    absolutePath,
    `Summoner spell image ${spellImageName}`,
  );
}

export async function validateRuneIcon(runeIconPath: string): Promise<void> {
  const filename = runeIconPath.split("/").pop() ?? "unknown.png";
  const relativePath = `./assets/img/rune/${filename}`;
  const absolutePath = getAbsolutePath(relativePath);
  await validateImageExists(absolutePath, `Rune image ${filename}`);
}

export async function validateAugmentIcon(
  augmentIconPath: string,
): Promise<void> {
  const filename = augmentIconPath.split("/").pop() ?? "unknown.png";
  const relativePath = `./assets/img/augment/${filename}`;
  const absolutePath = getAbsolutePath(relativePath);
  await validateImageExists(absolutePath, `Augment image ${filename}`);
}

export async function validateLaneIcon(lane: Lane): Promise<void> {
  const relativePath = `./assets/img/lane/${lane}.png`;
  const absolutePath = getAbsolutePath(relativePath);
  await validateImageExists(absolutePath, `Lane icon for ${lane}`);
}

// URL getters (synchronous, for use in components)
export function getChampionImageUrl(championName: string): string {
  const normalized = normalizeChampionName(championName);
  return `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/img/champion/${normalized}.png`;
}

export function getItemImageUrl(itemId: number): string {
  return `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/img/item/${itemId.toString()}.png`;
}

export function getSpellImageUrl(spellImageName: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/img/spell/${spellImageName}`;
}

export function getRuneIconUrl(runeIconPath: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/img/${runeIconPath}`;
}

export function getAugmentIconUrl(augmentIconPath: string): string {
  return `https://raw.communitydragon.org/latest/game/${augmentIconPath}`;
}

// Base64 getters (async, for Satori/server-side rendering with local cached assets)
export async function getChampionImageBase64(
  championName: string,
): Promise<string> {
  const normalized = normalizeChampionName(championName);
  const relativePath = `./assets/img/champion/${normalized}.png`;
  return loadImageAsBase64(relativePath, "image/png");
}

export async function getItemImageBase64(itemId: number): Promise<string> {
  const relativePath = `./assets/img/item/${itemId.toString()}.png`;
  return loadImageAsBase64(relativePath, "image/png");
}

export async function getSpellImageBase64(
  spellImageName: string,
): Promise<string> {
  const relativePath = `./assets/img/spell/${spellImageName}`;
  return loadImageAsBase64(relativePath, "image/png");
}

export async function getRuneIconBase64(runeIconPath: string): Promise<string> {
  const filename = runeIconPath.split("/").pop() ?? "unknown.png";
  const relativePath = `./assets/img/rune/${filename}`;
  return loadImageAsBase64(relativePath, "image/png");
}

export async function getAugmentIconBase64(
  augmentIconPath: string,
): Promise<string> {
  const filename = augmentIconPath.split("/").pop() ?? "unknown.png";
  const relativePath = `./assets/img/augment/${filename}`;
  return loadImageAsBase64(relativePath, "image/png");
}

export async function getLaneIconBase64(lane: Lane): Promise<string> {
  const relativePath = `./assets/img/lane/${lane}.png`;
  return loadImageAsBase64(relativePath, "image/png");
}

export async function getClassicBackgroundBase64(): Promise<string> {
  return loadImageAsBase64(
    "./assets/img/background/classic-jade.png",
    "image/png",
  );
}

// Champion loading screen art (tall portrait images used in LoL loading screen)

export async function validateChampionLoadingImage(
  championName: string,
): Promise<void> {
  const normalized = normalizeChampionName(championName);
  // Only the base skin (skin 0) is downloaded + shipped.
  const relativePath = `./assets/img/champion-loading/${normalized}_0.jpg`;
  const absolutePath = getAbsolutePath(relativePath);
  await validateImageExists(
    absolutePath,
    `Champion loading image for ${normalized}`,
  );
}

export function getChampionLoadingImageUrl(
  championName: string,
  skinNum = 0,
): string {
  const normalized = normalizeChampionName(championName);
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${normalized}_${skinNum.toString()}.jpg`;
}

export async function getChampionLoadingImageBase64(
  championName: string,
): Promise<string> {
  const normalized = normalizeChampionName(championName);
  // Only the base skin (skin 0) is ever rendered, so it's the only loading
  // screen art we download + ship (see update-data-dragon.ts).
  const requested = `./assets/img/champion-loading/${normalized}_0.jpg`;
  const requestedAbs = getAbsolutePath(requested);

  if (await Bun.file(requestedAbs).exists()) {
    return loadImageAsBase64(requested, "image/jpeg");
  }

  throw new Error(
    `Image not found at ${requestedAbs}. Run 'bun run update-data-dragon' in packages/data to cache latest assets.`,
  );
}

// Champion splash art (high-res landscape art, ≈1280×720) used as the full-bleed
// hero background for the ranked-banner / ranked-square report designs. Sourced
// **base skin 0 only** by update-data-dragon (CommunityDragon centered splash →
// Data Dragon splash fallback), so non-zero skin requests fall back to skin 0.

export async function validateChampionSplashImage(
  championName: string,
): Promise<void> {
  const normalized = normalizeChampionName(championName);
  // Only the base skin (skin 0) is downloaded + shipped.
  const relativePath = `./assets/img/champion-splash/${normalized}_0.jpg`;
  const absolutePath = getAbsolutePath(relativePath);
  await validateImageExists(
    absolutePath,
    `Champion splash image for ${normalized}`,
  );
}

export function getChampionSplashImageUrl(
  championName: string,
  skinNum = 0,
): string {
  const normalized = normalizeChampionName(championName);
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${normalized}_${skinNum.toString()}.jpg`;
}

export async function getChampionSplashImageBase64(
  championName: string,
): Promise<string> {
  const normalized = normalizeChampionName(championName);
  // Only the base skin (skin 0) is ever rendered, so it's the only splash art
  // we download + ship (see update-data-dragon.ts).
  const requested = `./assets/img/champion-splash/${normalized}_0.jpg`;
  const requestedAbs = getAbsolutePath(requested);

  if (await Bun.file(requestedAbs).exists()) {
    return loadImageAsBase64(requested, "image/jpeg");
  }

  throw new Error(
    `Image not found at ${requestedAbs}. Run 'bun run update-data-dragon' in packages/data to cache latest assets.`,
  );
}
