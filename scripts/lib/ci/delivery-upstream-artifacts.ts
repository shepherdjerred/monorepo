import { DeliveryClientError } from "@shepherdjerred/delivery/client";
import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import { mirrorMinecraftChart } from "./upstream-delivery-chart.ts";

/** Reuse the original qualified pin; upstream availability is needed only for a new acquisition. */
export async function minecraftChartForPublication(
  client: Pick<
    DeliveryClient,
    "latestQualifiedArtifact" | "acquireUpstreamArtifact"
  >,
  version: string,
  producer: {
    repositoryId: number;
    pipelineNumber: number;
    sourceRevision: string;
  },
  options: {
    credentials: () => { username: string; password: string };
    mirror?: typeof mirrorMinecraftChart;
  },
) {
  try {
    const original = await client.latestQualifiedArtifact({
      serviceId: "minecraft",
      component: "chart:minecraft",
      kind: "chart",
    });
    if (original.version === version) {
      if (
        original.origin.kind !== "upstream" ||
        original.origin.repository !==
          "https://itzg.github.io/minecraft-server-charts/" ||
        original.origin.name !== "minecraft" ||
        original.origin.version !== version ||
        original.origin.checksum !== original.digest
      )
        throw new Error(
          "Qualified Minecraft chart must retain its reviewed original upstream identity",
        );
      return original;
    }
  } catch (error) {
    if (!(error instanceof DeliveryClientError) || error.status !== 404)
      throw error;
  }
  const upstream = await (options.mirror ?? mirrorMinecraftChart)(
    version,
    options.credentials(),
  );
  const result = await client.acquireUpstreamArtifact({
    requestId: `ci/${String(producer.repositoryId)}/${String(producer.pipelineNumber)}/acquire/minecraft/${version}`,
    serviceId: "minecraft",
    sourceRevision: producer.sourceRevision,
    artifact: {
      id: `upstream/minecraft/${version}/${upstream.digest.slice(7)}`,
      component: "chart:minecraft",
      kind: "chart",
      uri: upstream.uri,
      digest: upstream.digest,
      version,
      origin: upstream.origin,
    },
  });
  if (result.status !== "verified")
    throw new Error(
      `Upstream minecraft chart acquisition is ${result.status}; no eligible CI reference was published`,
    );
  return result.artifact;
}
