import type { Site } from "../../types/Site";
import Stages from "./Stages";

export type SiteProps = {
  site: Site;
};

export default function Site({ site }: SiteProps) {
  return (
    <>
      <h3>{site.name}</h3>
      <Stages stages={site.stages} />
    </>
  );
}
