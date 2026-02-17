import { SiteFetcher } from "../manifest/siteFetcher";
import { stringToSite } from "../utilities";
import { Storage } from "./storage";

export class SiteFetcherStorage implements Storage<JSON> {
  readonly siteFetcher: SiteFetcher<JSON>;
  readonly allowWrite: boolean;

  constructor(siteFetcher: SiteFetcher<JSON>, allowWrite: boolean) {
    this.siteFetcher = siteFetcher;
    this.allowWrite = allowWrite;
  }

  set(_key: string, _value: JSON): Promise<undefined> {
    if (this.allowWrite) {
      return Promise.resolve(undefined);
    }
    throw new Error();
  }

  get(key: string): Promise<JSON> {
    return this.siteFetcher.get(stringToSite(key));
  }
}
