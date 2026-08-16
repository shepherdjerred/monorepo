import React from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const VersionsSchema = z.array(z.string()).min(1);
const ChampionListSchema = z.object({
  data: z.record(
    z.string(),
    z.looseObject({ id: z.string(), name: z.string() }),
  ),
});

type ChampionIconData = {
  version: string;
  /** Display name ("Kai'Sa") → ddragon id ("Kaisa"). */
  idByName: Map<string, string>;
};

// Riot's static-data CDN. The name→id map is built at runtime from
// champion.json rather than hardcoding irregulars (Kai'Sa→Kaisa,
// Wukong→MonkeyKing, Nunu & Willump→Nunu, …).
async function fetchChampionIconData(): Promise<ChampionIconData> {
  const versionsResponse = await fetch(
    "https://ddragon.leagueoflegends.com/api/versions.json",
  );
  if (!versionsResponse.ok) {
    throw new Error(
      `ddragon versions fetch failed: ${String(versionsResponse.status)}`,
    );
  }
  const versions = VersionsSchema.parse(await versionsResponse.json());
  const version = versions[0];
  if (version === undefined) {
    throw new Error("ddragon returned an empty version list");
  }

  const championsResponse = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`,
  );
  if (!championsResponse.ok) {
    throw new Error(
      `ddragon champion.json fetch failed: ${String(championsResponse.status)}`,
    );
  }
  const champions = ChampionListSchema.parse(await championsResponse.json());
  const idByName = new Map(
    Object.values(champions.data).map((champion) => [
      champion.name,
      champion.id,
    ]),
  );
  return { version, idByName };
}

function useChampionIconData(): ChampionIconData | undefined {
  const query = useQuery({
    queryKey: ["ddragon-champions"],
    queryFn: fetchChampionIconData,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
  return query.data;
}

/**
 * Champion square icon from Data Dragon. Renders nothing until the champion
 * map loads or when the name is unknown — the icon is decoration, never
 * load-bearing.
 */
export function ChampionIcon({
  name,
  className,
}: {
  name: string;
  className?: string | undefined;
}): React.ReactElement | null {
  const data = useChampionIconData();
  const id = data?.idByName.get(name);
  if (data === undefined || id === undefined) {
    return null;
  }
  return (
    <img
      src={`https://ddragon.leagueoflegends.com/cdn/${data.version}/img/champion/${id}.png`}
      alt=""
      aria-hidden
      loading="lazy"
      className={className ?? "size-6 rounded"}
    />
  );
}
