import type { KubernetesClient } from "@shepherdjerred/ops-clients/kubernetes.ts";
import type { LokiClient } from "@shepherdjerred/ops-clients/loki.ts";
import type { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";
import type { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type { OpsFacets } from "@shepherdjerred/ops-model/facets.ts";
import type { OpsCollectorOutcome } from "#activities/ops/ops-publish.ts";
import { collectCloudflareFacet } from "./cloudflare-facet.ts";
import { collectClusterFacet } from "./cluster-facet.ts";
import { collectFliptFacet } from "./flipt-facet.ts";
import { collectGolinkFacet } from "./golink-facet.ts";
import { collectMonorepoFacet } from "./monorepo-facet.ts";
import { collectObservabilityFacet } from "./observability-facet.ts";
import { collectTailscaleFacet } from "./tailscale-facet.ts";

const AUX_FACET_TIMEOUT_MS = 12_000;

async function settledTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs = AUX_FACET_TIMEOUT_MS,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          resolve(undefined);
        }, timeoutMs);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function extractOutcomeFacets(
  outcomes: readonly OpsCollectorOutcome[],
): Partial<OpsFacets> {
  const partial: Partial<OpsFacets> = {};
  for (const outcome of outcomes) {
    if (outcome.ok && outcome.result.facets !== undefined) {
      Object.assign(partial, outcome.result.facets);
    }
  }
  return partial;
}

export async function collectAuxiliaryFacets(input: {
  outcomes: readonly OpsCollectorOutcome[];
  services: ServiceIndex;
  kubernetes?: KubernetesClient;
  prometheus?: PrometheusClient;
  loki?: LokiClient;
  now: Date;
}): Promise<Partial<OpsFacets>> {
  const sourceFacets = extractOutcomeFacets(input.outcomes);
  const { kubernetes: k8s, prometheus: prom, loki, services, now } = input;

  const sharedPods =
    k8s === undefined
      ? undefined
      : await settledTimeout(() => k8s.listPods(), 6000);

  const [flipt, cloudflare, tailscale, golink, cluster, observability] =
    await Promise.all([
      settledTimeout(() => collectFliptFacet({ now })),
      settledTimeout(() => collectCloudflareFacet({ now })),
      settledTimeout(() =>
        collectTailscaleFacet({
          services,
          ...(sharedPods === undefined ? {} : { pods: sharedPods }),
          now,
        }),
      ),
      settledTimeout(() => collectGolinkFacet()),
      settledTimeout(() =>
        collectClusterFacet({
          services,
          ...(k8s === undefined ? {} : { kubernetes: k8s }),
          ...(prom === undefined ? {} : { prometheus: prom }),
        }),
      ),
      settledTimeout(() =>
        collectObservabilityFacet({
          ...(prom === undefined ? {} : { prometheus: prom }),
          ...(loki === undefined ? {} : { loki }),
          now,
        }),
      ),
    ]);

  const monorepoFacet = await settledTimeout(() =>
    collectMonorepoFacet({
      services,
      now,
      github: sourceFacets.github,
      renovate: sourceFacets.renovate,
      bugsink: sourceFacets.bugsink,
      flipt,
    }),
  );

  return {
    ...(flipt === undefined ? {} : { flipt }),
    ...(cloudflare === undefined ? {} : { cloudflare }),
    ...(tailscale === undefined ? {} : { tailscale }),
    ...(golink === undefined ? {} : { golink }),
    ...(cluster === undefined ? {} : { cluster }),
    ...(observability === undefined ? {} : { observability }),
    ...(monorepoFacet === undefined ? {} : { monorepo: monorepoFacet }),
  };
}
