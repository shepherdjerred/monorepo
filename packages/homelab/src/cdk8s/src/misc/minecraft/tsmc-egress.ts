import type { Chart } from "cdk8s";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  dnsEgressRule,
  flagsEgress,
  nsPeer,
  publicAddressPeer,
  tcp,
  udp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { BRAIN_PORT } from "@shepherdjerred/homelab/cdk8s/src/resources/storm-brain/index.ts";
import { STORM_STATS_INGEST_PORT } from "@shepherdjerred/homelab/cdk8s/src/resources/storm-stats/index.ts";

const NAMESPACE = "minecraft-tsmc";

/**
 * coreprotect.net's A records. CoreProtect calls
 * `http://coreprotect.net/license/` to validate the donation key, plus
 * `update.coreprotect.net` and `stats.coreprotect.net`, all over plain HTTP
 * that it cannot be configured to change. Every one of those names resolves to
 * these two Cloudflare addresses.
 *
 * Cloudflare can move these addresses at any time. To refresh them, run
 * `dig +short A coreprotect.net update.coreprotect.net stats.coreprotect.net`
 * and replace the list. A stale list shows up first as egress denials from
 * `minecraft-tsmc-0` to an `external` address on port 80 in
 * `bun run netpol:check minecraft-tsmc`, about every three hours, when
 * CoreProtect's update check runs. CoreProtect's own symptoms are "An error
 * occurred while checking for updates." in the server log and, once the
 * license it caches in `plugins/CoreProtect/.license` needs revalidating, an
 * "Invalid donation key." and a `co status` that no longer reports
 * "License: Valid donation key.".
 */
export const COREPROTECT_ADDRESSES = [
  "104.21.72.32/32",
  "172.67.174.103/32",
] as const;

/**
 * The Azure Front Door block that serves `textures.minecraft.net`. On each
 * join, BlueMap (`skin-download: true`) fetches the player's skin from the
 * plain-HTTP texture URL in the Mojang profile and draws it as the LiveMap
 * marker. Front Door moves the name between addresses in this /24; between
 * 2026-11-25 and 2026-11-28 it resolved to .145, .148 and .149. The range is
 * shared: other Mojang hosts and other Front Door customers sit behind it too,
 * so this rule opens port 80 to more than the texture host.
 *
 * Microsoft can move the name to another block at any time. To refresh it,
 * run `dig +short A textures.minecraft.net` a few times and replace this
 * value with the block that holds the answers. A stale block shows up first
 * as an egress denial from `minecraft-tsmc-0` to an `external` address on
 * port 80 in `bun run netpol:check minecraft-tsmc`, seconds after a player
 * joins. BlueMap then logs a failed skin download, writes no new
 * `playerheads/<uuid>.png`, and LiveMap shows the default head for that
 * player.
 */
export const MOJANG_TEXTURES_CIDR = "150.171.110.0/24";

/**
 * Where The Storm's game server connects, sized from 63 hours of the
 * enforcer's log for `minecraft-tsmc-0` (2026-11-25 to 2026-11-28, across
 * four pod addresses) and from the image's plugin configuration.
 *
 * - Cluster DNS.
 * - Flags evaluation (`FLAGS_URL`), for gameplay and rollout flags.
 * - storm-stats ingest (`STORM_STATS_INGEST_URL`), for the stats outbox.
 * - storm-brain (`brainUrl` in the safety, agent and companions configs).
 * - TCP 443 to public addresses: Mojang session and profile services, Xbox
 *   and Geyser for Bedrock players, Discord, PostHog, and plugin update
 *   checks. These addresses cannot be listed ahead of time.
 * - TCP 80 to CoreProtect's and Mojang's texture addresses only.
 * - UDP 3478 and 19302 to public addresses: Geyser's NetherNet STUN
 *   discovery (`stun.cloudflare.com`, `stun.l.google.com`), which it keeps
 *   open from udp/19132 while the server runs.
 *
 * Inbound traffic is governed by `createMinecraftProxyTrust` and
 * `createMinecraftPublicStatus`. Replies to it are not new connections, so
 * this policy does not need to open them.
 */
export function createMinecraftTsmcEgress(chart: Chart): KubeNetworkPolicy {
  return new KubeNetworkPolicy(chart, `${NAMESPACE}-egress`, {
    metadata: { name: `${NAMESPACE}-egress`, namespace: NAMESPACE },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"],
      egress: [
        dnsEgressRule(),
        flagsEgress(),
        {
          to: [nsPeer("storm-stats")],
          ports: [tcp(STORM_STATS_INGEST_PORT)],
        },
        { to: [nsPeer("storm-brain")], ports: [tcp(BRAIN_PORT)] },
        { to: [publicAddressPeer()], ports: [tcp(443)] },
        {
          to: [
            ...COREPROTECT_ADDRESSES.map((cidr) => ({ ipBlock: { cidr } })),
            { ipBlock: { cidr: MOJANG_TEXTURES_CIDR } },
          ],
          ports: [tcp(80)],
        },
        { to: [publicAddressPeer()], ports: [udp(3478), udp(19_302)] },
      ],
    },
  });
}
