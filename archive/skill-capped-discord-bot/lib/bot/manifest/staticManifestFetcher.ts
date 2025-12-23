import { readFile } from "fs/promises";
import Site from "../site";
import { siteToString } from "../utilities";
import { SiteFetcher } from "./siteFetcher";

export class StaticManifestFetcher implements SiteFetcher<JSON> {
  readonly folder: string;
  constructor(folder: string) {
    this.folder = folder;
  }

  async get(site: Site): Promise<JSON> {
    const result = await readFile(
      "./data/static/" + this.folder + "/" + siteToString(site) + ".json",
      "utf-8"
    );
    const json = JSON.parse(result) as JSON;
    return Promise.resolve(json);
  }
}
