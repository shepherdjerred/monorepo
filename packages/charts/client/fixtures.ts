import type {
  CatalogSummary,
  ChartReleaseView,
  ChartSummaryItem,
} from "./model.ts";

function makeRelease(input: {
  readonly name: string;
  readonly version: string;
  readonly appVersion: string;
  readonly description: string;
  readonly digestSeed: string;
  readonly fingerprintSeed: string | null;
  readonly sizeBytes: number;
  readonly created: string;
}): ChartReleaseView {
  const digest = input.digestSeed.padEnd(64, "0").slice(0, 64);
  const contentFingerprint =
    input.fingerprintSeed === null
      ? null
      : `sha256:${input.fingerprintSeed.padEnd(64, "a").slice(0, 64)}`;
  return {
    name: input.name,
    version: input.version,
    appVersion: input.appVersion,
    apiVersion: "v2",
    description: input.description,
    urls: [`charts/${input.name}-${input.version}.tgz`],
    digest,
    created: input.created,
    sizeBytes: input.sizeBytes,
    contentFingerprint,
  };
}

function summarizeChart(
  kind: "first-party" | "upstream",
  releases: readonly [ChartReleaseView, ...ChartReleaseView[]],
): ChartSummaryItem {
  const latest = releases[0];
  const totalBytes = releases.reduce((sum, item) => sum + item.sizeBytes, 0);
  return {
    name: latest.name,
    kind,
    latestVersion: latest.version,
    latestAppVersion: latest.appVersion,
    description: latest.description,
    releaseCount: releases.length,
    totalBytes,
    latestDigest: latest.digest,
    latestContentFingerprint: latest.contentFingerprint,
    latestCreated: latest.created,
    latestUrl: latest.urls[0] ?? `charts/${latest.name}-${latest.version}.tgz`,
    releases,
  };
}

const DEMO_CHARTS: readonly ChartSummaryItem[] = [
  summarizeChart("upstream", [
    makeRelease({
      name: "argo-cd",
      version: "7.8.23",
      appVersion: "v2.14.9",
      description: "Declarative continuous delivery for Kubernetes",
      digestSeed: "7f4e9c1b2a08d354e61f",
      fingerprintSeed: null,
      sizeBytes: 318_420,
      created: "2026-11-21T14:12:00Z",
    }),
    makeRelease({
      name: "argo-cd",
      version: "7.8.20",
      appVersion: "v2.14.7",
      description: "Declarative continuous delivery for Kubernetes",
      digestSeed: "1b92a8d3c47e50f1920a",
      fingerprintSeed: null,
      sizeBytes: 316_110,
      created: "2026-11-04T09:30:00Z",
    }),
  ]),
  summarizeChart("upstream", [
    makeRelease({
      name: "cert-manager",
      version: "v1.21.2",
      appVersion: "v1.21.2",
      description: "Cloud Native Certificate Management mirror",
      digestSeed: "9c04e18f3d2b7a6510cc",
      fingerprintSeed: null,
      sizeBytes: 142_880,
      created: "2026-11-18T19:05:00Z",
    }),
  ]),
  summarizeChart("first-party", [
    makeRelease({
      name: "delivery",
      version: "2.0.0-101844",
      appVersion: "2.0.0-101844",
      description: "Homelab release control plane and artifact ledger",
      digestSeed: "4a8b12f90e3c71d65521",
      fingerprintSeed: "88f1c2093e4a77b2",
      sizeBytes: 18_940,
      created: "2026-11-24T22:41:00Z",
    }),
    makeRelease({
      name: "delivery",
      version: "2.0.0-101839",
      appVersion: "2.0.0-101839",
      description: "Homelab release control plane and artifact ledger",
      digestSeed: "2d77c0918a5b34ef6012",
      fingerprintSeed: "61b09da442f811c0",
      sizeBytes: 18_812,
      created: "2026-11-24T17:19:00Z",
    }),
    makeRelease({
      name: "delivery",
      version: "2.0.0-101831",
      appVersion: "2.0.0-101831",
      description: "Homelab release control plane and artifact ledger",
      digestSeed: "e055a13c9f8b72d41109",
      fingerprintSeed: "39ca81d07e1255ab",
      sizeBytes: 18_604,
      created: "2026-11-23T23:50:00Z",
    }),
  ]),
  summarizeChart("first-party", [
    makeRelease({
      name: "flags",
      version: "2.0.0-101842",
      appVersion: "2.0.0-101842",
      description: "Deployment flag authoring console and evaluator",
      digestSeed: "c1309f8e7d6a54b20817",
      fingerprintSeed: "d41e82f09a6c31b5",
      sizeBytes: 12_480,
      created: "2026-11-24T20:14:00Z",
    }),
  ]),
  summarizeChart("first-party", [
    makeRelease({
      name: "golink",
      version: "2.0.0-101844",
      appVersion: "2.0.0-101844",
      description: "Tailnet shortlink directory and redirector",
      digestSeed: "5e21b40d9c8371fa6234",
      fingerprintSeed: "90ab43e211cf872d",
      sizeBytes: 14_210,
      created: "2026-11-24T22:41:00Z",
    }),
    makeRelease({
      name: "golink",
      version: "2.0.0-101820",
      appVersion: "2.0.0-101820",
      description: "Tailnet shortlink directory and redirector",
      digestSeed: "8a11f20e4d93b7c65102",
      fingerprintSeed: "12fe77a903bc41d8",
      sizeBytes: 14_096,
      created: "2026-11-22T15:08:00Z",
    }),
  ]),
  summarizeChart("first-party", [
    makeRelease({
      name: "scout-beta",
      version: "2.0.0-101843",
      appVersion: "2.0.0-101843",
      description: "Scout for League of Legends beta Discord bot and workers",
      digestSeed: "b734d91a0c5e82f46390",
      fingerprintSeed: "77cd09e412ab65f3",
      sizeBytes: 24_620,
      created: "2026-11-24T21:33:00Z",
    }),
  ]),
  summarizeChart("upstream", [
    makeRelease({
      name: "tailscale-operator",
      version: "1.82.0",
      appVersion: "v1.82.0",
      description: "Tailscale Kubernetes operator mirror",
      digestSeed: "3f80a21c6e94d7b52018",
      fingerprintSeed: null,
      sizeBytes: 94_512,
      created: "2026-11-15T11:27:00Z",
    }),
  ]),
];

export const DEMO_CATALOG_SUMMARY: CatalogSummary = {
  chartCount: DEMO_CHARTS.length,
  releaseCount: DEMO_CHARTS.reduce((sum, item) => sum + item.releaseCount, 0),
  totalBytes: DEMO_CHARTS.reduce((sum, item) => sum + item.totalBytes, 0),
  quotaBytes: 8_589_934_592,
  catalogRevision: 184,
  charts: DEMO_CHARTS,
};

export const EMPTY_CATALOG_SUMMARY: CatalogSummary = {
  chartCount: 0,
  releaseCount: 0,
  totalBytes: 0,
  quotaBytes: 8_589_934_592,
  catalogRevision: 0,
  charts: [],
};
