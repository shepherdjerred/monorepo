export function satoriFontUrl(relativePath: string): URL {
  return new URL(`../../assets/fonts/${relativePath}`, import.meta.url);
}

export function satoriRankAssetUrl(rank: string): URL {
  return new URL(`../../assets/ranks/Rank=${rank}.png`, import.meta.url);
}

export function browserRankAssetUrl(rank: string): string {
  return `/assets/scout/shared/ranks/Rank=${rank}.png`;
}
