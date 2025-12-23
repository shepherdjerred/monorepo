import Site from "../site";

export interface SiteFetcher<T> {
  get(site: Site): Promise<T>;
}
