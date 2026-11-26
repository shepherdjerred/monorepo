import type { NetworkPolicyEgressRule } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

/**
 * The pod ports of the media namespace's apps that call each other: Sonarr,
 * Radarr and Prowlarr sync indexers and grab through qBittorrent; Bazarr reads
 * Sonarr and Radarr and transcribes through whisperbridge; Seerr, Maintainerr
 * and Tautulli read Plex and the *arr apps.
 */
const MEDIA_PEER_PORTS = [
  8989, // Sonarr
  7878, // Radarr
  9696, // Prowlarr
  8080, // qBittorrent Web API
  32_400, // Plex
  5055, // Seerr
  8181, // Tautulli
  9000, // whisperbridge
] as const;

/**
 * The Egress rules of a media app whose integrations live in its own
 * database: cluster DNS, its media peers in the namespace, and HTTPS to the
 * internet. Every configured indexer, list, metadata source, subtitle
 * provider and notification webhook was read from the apps' settings and
 * observed in the enforcer's log on 443 (2026-11-24); `extra` adds what one app
 * reaches beyond that.
 */
export function mediaAppEgress(
  extra: NetworkPolicyEgressRule[] = [],
): NetworkPolicyEgressRule[] {
  return [
    dnsEgressRule(),
    {
      to: [{ podSelector: {} }],
      ports: MEDIA_PEER_PORTS.map((port) => tcp(port)),
    },
    externalHttpsEgressRule(),
    ...extra,
  ];
}
