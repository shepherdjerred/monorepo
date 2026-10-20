import type { Link } from "@shepherdjerred/ops-model/snapshot.ts";
import {
  TOOL_HOSTS,
  chartmuseumChartLink,
} from "@shepherdjerred/ops-model/tool-links.ts";
import type { ArtifactVersion } from "#shared/contract.ts";

/** Registry pages for an artifact that a browser can open. */
export function artifactToolLinks(artifact: ArtifactVersion): Link[] {
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
