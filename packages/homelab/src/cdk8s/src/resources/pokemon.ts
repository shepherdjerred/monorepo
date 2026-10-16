import { Size, type Chart } from "cdk8s";
import { Service } from "cdk8s-plus-31";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { createPokemonWebRedirect } from "@shepherdjerred/homelab/cdk8s/src/resources/pokemon-web-redirect.ts";

/** Retain original progress and old bookmarks after Arcade takes ownership. */
export function createPokemonResources(chart: Chart) {
  new ZfsNvmeVolume(chart, "pokemon-volume", { storage: Size.gibibytes(8) });
  const redirect = createPokemonWebRedirect(chart);
  const uiService = new Service(chart, "ui-service", {
    metadata: { labels: { app: "pokemon-redirect" } },
    selector: redirect,
    ports: [{ port: 8081, name: "ui" }],
  });
  new TailscaleIngress(chart, "ui-tailscale-ingress", {
    service: uiService,
    host: "pokebot",
    probePath: "/health",
  });
  createCloudflareTunnelBinding(chart, "pokebot-cf-tunnel", {
    serviceName: uiService.name,
    subdomain: "pokebot",
    port: 8081,
    probePath: "/health",
  });
}
