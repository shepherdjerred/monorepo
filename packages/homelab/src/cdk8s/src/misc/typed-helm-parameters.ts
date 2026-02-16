/**
 * Utility functions for converting between typed Helm values and ArgoCD parameters
 */

import { z } from "zod";

export type HelmParameter = { name: string; value: string };

/**
 * Convert a typed Helm values object to ArgoCD parameters array (dot notation)
 */
export function valuesToParameters(values: Record<string, unknown>, prefix = ""): HelmParameter[] {
  const parameters: HelmParameter[] = [];

  for (const [key, value] of Object.entries(values)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      continue;
    }

    // Use Zod to validate if value is a plain object (not array)
    const ObjectSchema = z.record(z.string(), z.unknown());
    const ArraySchema = z.array(z.unknown());

    const objectParseResult = ObjectSchema.safeParse(value);
    if (objectParseResult.success && !ArraySchema.safeParse(value).success) {
      // Recursively handle nested objects
      parameters.push(...valuesToParameters(objectParseResult.data, fullKey));
    } else {
      // Convert values to strings with proper handling
      let stringValue: string;
      const arrayParseResult = ArraySchema.safeParse(value);
      const objectParseResult = z.record(z.string(), z.unknown()).safeParse(value);

      if (arrayParseResult.success) {
        stringValue = JSON.stringify(arrayParseResult.data);
      } else if (objectParseResult.success) {
        stringValue = JSON.stringify(objectParseResult.data);
      } else {
        // Handle primitive values - at this point it should be string, number, boolean
        const PrimitiveSchema = z.union([z.string(), z.number(), z.boolean()]);
        const primitiveResult = PrimitiveSchema.safeParse(value);

        if (primitiveResult.success) {
          stringValue = String(primitiveResult.data);
        } else {
          // Fallback for any other types (should be rare)
          stringValue = JSON.stringify(value);
        }
      }
      parameters.push({
        name: fullKey,
        value: stringValue,
      });
    }
  }

  return parameters;
}

/**
 * Create typed parameters with validation
 */
export function createTypedParameters(values: Record<string, unknown>): HelmParameter[] {
  return valuesToParameters(values);
}

import type { ArgocdHelmValues } from "../../generated/helm/argo-cd.types";
import type { CertmanagerHelmValues } from "../../generated/helm/cert-manager.types";
import type { ChartmuseumHelmValues } from "../../generated/helm/chartmuseum.types";
import type { ConnectHelmValues } from "../../generated/helm/connect.types";
import type { InteldevicepluginsoperatorHelmValues } from "../../generated/helm/intel-device-plugins-operator.types";
import type { KubeprometheusstackHelmValues } from "../../generated/helm/kube-prometheus-stack.types";
import type { PrometheusadapterHelmValues } from "../../generated/helm/prometheus-adapter.types";
import type { LokiHelmValues } from "../../generated/helm/loki.types";
import type { MinecraftHelmValues } from "../../generated/helm/minecraft.types";
import type { NodefeaturediscoveryHelmValues } from "../../generated/helm/node-feature-discovery.types";
import type { OpenebsHelmValues } from "../../generated/helm/openebs.types";
import type { PostgresoperatorHelmValues } from "../../generated/helm/postgres-operator.types";
import type { PromtailHelmValues } from "../../generated/helm/promtail.types";
import type { TailscaleoperatorHelmValues } from "../../generated/helm/tailscale-operator.types";
import type { VeleroHelmValues } from "../../generated/helm/velero.types";
import type { CoderHelmValues } from "../../generated/helm/coder.types";
import type { RedisHelmValues } from "../../generated/helm/redis.types";
import type { SeaweedfsHelmValues } from "../../generated/helm/seaweedfs.types";
import type { PrometheusblackboxexporterHelmValues } from "../../generated/helm/prometheus-blackbox-exporter.types";
import type { McrouterHelmValues } from "../../generated/helm/mc-router.types";

type HelmChartValuesMap = {
  "argo-cd": ArgocdHelmValues;
  "cert-manager": CertmanagerHelmValues;
  chartmuseum: ChartmuseumHelmValues;
  connect: ConnectHelmValues;
  "intel-device-plugins-operator": InteldevicepluginsoperatorHelmValues;
  "kube-prometheus-stack": KubeprometheusstackHelmValues;
  "prometheus-adapter": PrometheusadapterHelmValues;
  loki: LokiHelmValues;
  minecraft: MinecraftHelmValues;
  "node-feature-discovery": NodefeaturediscoveryHelmValues;
  openebs: OpenebsHelmValues;
  "postgres-operator": PostgresoperatorHelmValues;
  promtail: PromtailHelmValues;
  "tailscale-operator": TailscaleoperatorHelmValues;
  velero: VeleroHelmValues;
  coder: CoderHelmValues;
  redis: RedisHelmValues;
  seaweedfs: SeaweedfsHelmValues;
  "prometheus-blackbox-exporter": PrometheusblackboxexporterHelmValues;
  "mc-router": McrouterHelmValues;
};

export type HelmValuesForChart<TChart extends keyof HelmChartValuesMap> = HelmChartValuesMap[TChart];
