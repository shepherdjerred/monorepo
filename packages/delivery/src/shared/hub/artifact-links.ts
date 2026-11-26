import type { Link } from "@shepherdjerred/ops-model/snapshot.ts";
import {
  APP_HOSTS,
  chartmuseumChartLink,
} from "@shepherdjerred/ops-model/tool-links.ts";
import type { ArtifactVersion } from "#shared/contract.ts";

const HISTORICAL_CHARTMUSEUM_HOST = "https://chartmuseum.tailnet-1a49.ts.net";

/** Registry pages for an artifact that a browser can open. */
export function artifactToolLinks(artifact: ArtifactVersion): Link[] {
  if (
    artifact.kind === "chart" &&
    (artifact.uri.startsWith(APP_HOSTS.charts) ||
      artifact.uri.startsWith(HISTORICAL_CHARTMUSEUM_HOST))
  )
    return [
      chartmuseumChartLink(
        artifact.component.replace(/^chart:/, ""),
        artifact.version,
      ),
    ];
  return [];
}
