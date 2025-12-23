import axios from "axios";
import Site from "../site";
import { SiteFetcher } from "./siteFetcher";

export class LiveManifestFetcher implements SiteFetcher<JSON> {
  async get(site: Site): Promise<JSON> {
    const endpoint = this.siteToEndpoint(site);
    const body = (await (
      await axios.get(`https://www.skill-capped.com/${endpoint}/browse`)
    ).data) as string;
    const manifestUrl = this.extractManifestUrl(body);
    if (manifestUrl) {
      const json = (await (await axios.get(manifestUrl)).data) as string;
      return JSON.parse(json) as JSON;
    }

    throw Error("Couldn't fetch manifest");
  }

  siteToEndpoint(site: Site) {
    switch (site) {
      case Site.LEAGUE_OF_LEGENDS:
        return "lol";
      case Site.WORLD_OF_WARCRAFT:
        return "wow";
      case Site.VALORANT:
        return "valorant";
      default:
        throw Error("Invalid site");
    }
  }

  extractManifestUrl(body: string): string | undefined {
    const match = body.match(/loc: *"(.*)"/);
    if (match) {
      return match[1];
    } else {
      return undefined;
    }
  }
}
