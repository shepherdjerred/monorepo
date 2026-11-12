import type { Construct } from "constructs";
import { TerraformVariable } from "cdktn";
import { DhcpStaticLease } from "#generated/providers/asuswrt/dhcp-static-lease/index.ts";
import { PortForward } from "#generated/providers/asuswrt/port-forward/index.ts";
import { AsuswrtProvider } from "#generated/providers/asuswrt/provider/index.ts";
import { System } from "#generated/providers/asuswrt/system/index.ts";
import { WirelessNetwork } from "#generated/providers/asuswrt/wireless-network/index.ts";
import { HomelabStack } from "#src/homelab-stack.ts";

/**
 * Configuration of the three home Asus devices, through the provider built
 * from `packages/terraform-provider-asuswrt`. The devices answer only on the
 * LAN, so the stack is planned and applied from a workstation, never by CI or
 * Delivery. See `packages/homelab/src/tofu/asuswrt/README.md`.
 *
 * Every value mirrors the live device, so an import produces a clean plan.
 */
export class AsuswrtStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "asuswrt", {
      requiredVersion: ">= 1.6.0",
      // Not published to a registry: the stack runner builds the provider
      // into a filesystem mirror at exactly this version.
      providerConstraints: { asuswrt: "0.1.0" },
    });

    const username = new TerraformVariable(this, "asuswrt_username", {
      description:
        "Admin username for the Asus routers/APs (same on all three). Set via TF_VAR_asuswrt_username.",
      type: "string",
    });
    const password = new TerraformVariable(this, "asuswrt_password", {
      description:
        "Admin password for the Asus routers/APs (same on all three). Set via TF_VAR_asuswrt_password.",
      type: "string",
      sensitive: true,
    });

    // One aliased provider per device. All three share the same credentials,
    // serve a self-signed certificate and are reachable only on the LAN.
    const device = (alias: string, host: string): AsuswrtProvider =>
      new AsuswrtProvider(this, `asuswrt_${alias}`, {
        alias,
        host,
        port: 8443,
        https: true,
        insecure: true,
        username: username.stringValue,
        password: password.stringValue,
      });
    const router = device("router", "192.168.1.1");
    const apBe86u = device("ap_be86u", "192.168.1.2");
    const apAx88u = device("ap_ax88u", "192.168.1.214");

    // RT-AX88U Pro @ 192.168.1.1 (main router, sw_mode=1).
    new System(this, "router", {
      provider: router,
      hostname: "RT-AX88U_Pro-74C0", // NVRAM lan_hostname
      timezone: "PST8DST",
      ntpServer0: "pool.ntp.org",
      ntpServer1: "time.nist.gov",
    });

    // DHCP static leases.
    new DhcpStaticLease(this, "ax88u_ap", {
      provider: router,
      mac: "24:4B:FE:D0:9B:A0",
      ip: "192.168.1.214",
      hostname: "RT-AX88U-9BA0",
    });
    new DhcpStaticLease(this, "plex_host", {
      provider: router,
      mac: "08:BF:B8:D4:59:7F",
      ip: "192.168.1.81",
    });
    new DhcpStaticLease(this, "lease_61", {
      provider: router,
      mac: "48:DA:35:6F:61:BF",
      ip: "192.168.1.61",
    });
    new DhcpStaticLease(this, "lease_90", {
      provider: router,
      mac: "4C:B9:EA:97:90:5A",
      ip: "192.168.1.90",
    });
    new DhcpStaticLease(this, "lease_43", {
      provider: router,
      mac: "50:26:EF:28:F1:DE",
      ip: "192.168.1.43",
    });
    new DhcpStaticLease(this, "lease_173", {
      provider: router,
      mac: "50:26:EF:29:70:EE",
      ip: "192.168.1.173",
    });

    // Port forwards, all to the Kubernetes node.
    new PortForward(this, "mario_kart_http", {
      provider: router,
      name: "Mario Kart HTTP",
      protocol: "TCP",
      externalPort: "80",
      internalIp: "192.168.1.81",
      internalPort: "30080",
    });
    new PortForward(this, "mario_kart_https", {
      provider: router,
      name: "Mario Kart HTTPS",
      protocol: "TCP",
      externalPort: "443",
      internalIp: "192.168.1.81",
      internalPort: "30443",
    });
    new PortForward(this, "plex", {
      provider: router,
      name: "Plex",
      protocol: "TCP",
      externalPort: "32400",
      internalIp: "192.168.1.81",
      internalPort: "32400",
    });
    new PortForward(this, "minecraft_mc_router", {
      provider: router,
      name: "Minecraft mc-router",
      protocol: "TCP",
      externalPort: "30000",
      internalIp: "192.168.1.81",
      internalPort: "30000",
    });
    // The rule name is spelled "Mineraft Bedrock" on the device; kept verbatim
    // so the identity matches (renaming would force a replace).
    new PortForward(this, "minecraft_bedrock", {
      provider: router,
      name: "Mineraft Bedrock",
      protocol: "UDP",
      externalPort: "30003",
      internalIp: "192.168.1.81",
      internalPort: "30003",
    });
    new PortForward(this, "minecraft_tsmc_bedrock", {
      provider: router,
      name: "The Storm Bedrock",
      protocol: "UDP",
      externalPort: "30004",
      internalIp: "192.168.1.81",
      internalPort: "30004",
    });

    // Wireless. wpa_passphrase is intentionally omitted: it is write-only and
    // would churn every plan and apply, so the PSK is managed out-of-band.
    new WirelessNetwork(this, "wl0", {
      provider: router,
      band: 0,
      ssid: "Jerred",
      authMode: "psk2sae",
      crypto: "aes",
      channel: 6,
      bandwidth: 1,
      hidden: false,
    });
    new WirelessNetwork(this, "wl1", {
      provider: router,
      band: 1,
      ssid: "Jerred",
      authMode: "psk2sae",
      crypto: "aes",
      channel: 149,
      bandwidth: 3,
      hidden: false,
    });

    // RT-AX88U @ 192.168.1.214 (access point, sw_mode=3). In AP mode the DHCP
    // server, WAN and port forwards are inert, so only system and wireless
    // are managed. ntp_server_1 is empty on this device, so it is omitted.
    new System(this, "ax88u", {
      provider: apAx88u,
      hostname: "RT-AX88U-9BA0", // NVRAM lan_hostname
      timezone: "PST8DST",
      ntpServer0: "pool.ntp.org",
    });
    // Channel 0 and bandwidth 0 are "auto".
    new WirelessNetwork(this, "ax88u_wl0", {
      provider: apAx88u,
      band: 0,
      ssid: "Jerred",
      authMode: "psk2",
      crypto: "aes",
      channel: 0,
      bandwidth: 0,
      hidden: false,
    });
    new WirelessNetwork(this, "ax88u_wl1", {
      provider: apAx88u,
      band: 1,
      ssid: "Jerred",
      authMode: "psk2",
      crypto: "aes",
      channel: 0,
      bandwidth: 0,
      hidden: false,
    });

    // RT-BE86U @ 192.168.1.2 (access point, sw_mode=3).
    //
    // Wireless is intentionally NOT managed here yet. On this device wl0/wl1
    // read back as a 32-hex, hidden (closed=1) SSID with crypto aes+gcmp256,
    // the signature of a former-AiMesh backhaul interface, NOT the real
    // "Jerred" fronthaul (which likely lives on a virtual interface such as
    // wl0.1). Managing wl0/wl1 as-is would manage the backhaul. Resolve the
    // real fronthaul indices before adding wireless resources here.
    new System(this, "be86u", {
      provider: apBe86u,
      hostname: "RT-BE86U-9E90", // NVRAM lan_hostname
      timezone: "PST8DST",
      ntpServer0: "pool.ntp.org",
      ntpServer1: "time.nist.gov",
    });
  }
}
