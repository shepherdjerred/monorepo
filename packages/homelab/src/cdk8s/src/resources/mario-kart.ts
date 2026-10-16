import { Size, type Chart } from "cdk8s";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { createMarioKartDirectIngress } from "@shepherdjerred/homelab/cdk8s/src/resources/mario-kart-direct-ingress.ts";

/** Retain the original game storage and canonical edge after Arcade takes ownership. */
export function createMarioKartResources(chart: Chart) {
  new ZfsNvmeVolume(chart, "mario-kart-volume", { storage: Size.gibibytes(8) });
  new ZfsNvmeVolume(chart, "mario-kart-rom-volume", {
    storage: Size.gibibytes(1),
  });
  new ZfsNvmeVolume(chart, "mario-kart-data-volume", {
    storage: Size.gibibytes(1),
  });

  const bootstrap = createMarioKartDirectIngress(
    chart,
    "arcade-arcade-ui.arcade.svc.cluster.local:8081",
  );
  new TailscaleIngress(chart, "ui-tailscale-ingress", {
    service: bootstrap,
    host: "mariokart",
  });
  createCloudflareTunnelBinding(chart, "mariokart-cf-tunnel", {
    serviceName: bootstrap.name,
    subdomain: "mariokart",
    port: 8082,
  });
}
