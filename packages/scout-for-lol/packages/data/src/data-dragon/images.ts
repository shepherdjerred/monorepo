import { latestVersion } from "./version.ts";

const championNameOverrides: Record<string, string> = {
  FiddleSticks: "Fiddlesticks",
};

export function normalizeChampionName(championName: string): string {
  return championNameOverrides[championName] ?? championName;
}

function getAbsolutePath(relativePath: string): string {
  return new URL(relativePath, import.meta.url).pathname;
}

async function validateImageExists(absolutePath: string, description: string): Promise<void> {
  const file = Bun.file(absolutePath);
  const exists = await file.exists();

  if (!exists) {
    throw new Error(
      `${description} not found at ${absolutePath}. Run 'bun run update-data-dragon' in packages/data to cache latest assets.`,
    );
  }
}

// Helper function to load an image as base64 data URI
async function loadImageAsBase64(relativePath: string, mimeType: string): Promise<string> {
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
export async function validateChampionImage(championName: string): Promise<void> {
  const normalized = normalizeChampionName(championName);
  const relativePath = `./assets/img/champion/${normalized}.png`;
  const absolutePath = getAbsolutePath(relativePath);
  await validateImageExists(absolutePath, `Champion image for ${normalized}`);
}

export async function validateItemImage(itemId: number): Promise<void> {
  const relativePath = `./assets/img/item/${itemId.toString()}.png`;
  const absolutePath = getAbsolutePath(relativePath);
  await validateImageExists(absolutePath, `Item image for item ${itemId.toString()}`);
}

export async function validateSpellImage(spellImageName: string): Promise<void> {
  const relativePath = `./assets/img/spell/${spellImageName}`;
  const absolutePath = getAbsolutePath(relativePath);
  await validateImageExists(absolutePath, `Summoner spell image ${spellImageName}`);
}

export async function validateRuneIcon(runeIconPath: string): Promise<void> {
  const filename = runeIconPath.split("/").pop() ?? "unknown.png";
  const relativePath = `./assets/img/rune/${filename}`;
  const absolutePath = getAbsolutePath(relativePath);
  await validateImageExists(absolutePath, `Rune image ${filename}`);
}

export async function validateAugmentIcon(augmentIconPath: string): Promise<void> {
  const filename = augmentIconPath.split("/").pop() ?? "unknown.png";
  const relativePath = `./assets/img/augment/${filename}`;
  const absolutePath = getAbsolutePath(relativePath);
  await validateImageExists(absolutePath, `Augment image ${filename}`);
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
export async function getChampionImageBase64(championName: string): Promise<string> {
  const normalized = normalizeChampionName(championName);
  const relativePath = `./assets/img/champion/${normalized}.png`;
  return loadImageAsBase64(relativePath, "image/png");
}

export async function getItemImageBase64(itemId: number): Promise<string> {
  const relativePath = `./assets/img/item/${itemId.toString()}.png`;
  return loadImageAsBase64(relativePath, "image/png");
}

export async function getSpellImageBase64(spellImageName: string): Promise<string> {
  const relativePath = `./assets/img/spell/${spellImageName}`;
  return loadImageAsBase64(relativePath, "image/png");
}

export async function getRuneIconBase64(runeIconPath: string): Promise<string> {
  const filename = runeIconPath.split("/").pop() ?? "unknown.png";
  const relativePath = `./assets/img/rune/${filename}`;
  return loadImageAsBase64(relativePath, "image/png");
}

export async function getAugmentIconBase64(augmentIconPath: string): Promise<string> {
  const filename = augmentIconPath.split("/").pop() ?? "unknown.png";
  const relativePath = `./assets/img/augment/${filename}`;
  return loadImageAsBase64(relativePath, "image/png");
}
