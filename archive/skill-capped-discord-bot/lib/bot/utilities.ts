import Site from "./site";

export function stringToSite(target: string): Site {
  return [Site.LEAGUE_OF_LEGENDS, Site.WORLD_OF_WARCRAFT, Site.VALORANT]
    .map((site) => {
      return [site, siteToString(site)];
    })
    .filter(([_, str]) => {
      return str === target;
    })[0][0] as Site;
}

export function siteToString(site: Site): string {
  switch (site) {
    case Site.LEAGUE_OF_LEGENDS:
      return "leagueOfLegends";
    case Site.WORLD_OF_WARCRAFT:
      return "worldOfWarcraft";
    case Site.VALORANT:
      return "valorant";
    default:
      throw Error("Invalid site");
  }
}
