import type { Site } from "../../types/Site";
import * as R from "remeda";
import SiteComponent from "./Site";

export type SitesProps = {
  sites: Site[];
};

export default function Sites({ sites }: SitesProps) {
  const siteComponents = R.map(sites, (site) => {
    return <SiteComponent key={site.id} site={site} />;
  });

  return (
    <>
      <h2>Your Sites</h2>
      {siteComponents}
    </>
  );
}
