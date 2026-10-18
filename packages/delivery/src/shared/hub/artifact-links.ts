import type { Link } from "@shepherdjerred/ops-model/snapshot.ts";
import {
  TOOL_HOSTS,
  chartmuseumChartLink,
  dockerHubTagLink,
} from "@shepherdjerred/ops-model/tool-links.ts";
import type { ArtifactVersion } from "#shared/contract.ts";

/** Registry pages for an artifact; archives live in private storage. */
export function artifactToolLinks(artifact: ArtifactVersion): Link[] {
  if (artifact.kind === "image") {
    const link = dockerHubTagLink(artifact.uri);
    return link === null ? [] : [link];
  }
  if (
    artifact.kind === "chart" &&
    artifact.uri.startsWith(TOOL_HOSTS.chartmuseum)
  )
    return [
      chartmuseumChartLink(
        artifact.component.replace(/^chart:/, ""),
        artifact.version,
      ),
    ];
  return [];
}
