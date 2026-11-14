import { expect, test } from "vitest";
import { z } from "zod";
import { asuswrtProviderPin } from "homelab/scripts/tofu/asuswrt-provider.ts";
import {
  ProviderBlocksSchema,
  synthesizedStack,
  VariablesSchema,
  VersionedTerraformSchema,
} from "#src/testing.ts";

// This stack's state is not encrypted, so it has no `encryption` block.
const ConfigurationSchema = z.looseObject({
  terraform: VersionedTerraformSchema.partial({ encryption: true }),
  provider: ProviderBlocksSchema,
  variable: VariablesSchema,
  resource: z.record(
    z.string(),
    z.record(z.string(), z.looseObject({ provider: z.string() })),
  ),
});

async function asuswrt() {
  return await synthesizedStack("asuswrt", ConfigurationSchema);
}

/** Every address of the stack's state, with the device alias that owns it. */
const ADDRESSES = {
  "asuswrt_dhcp_static_lease.ax88u_ap": "router",
  "asuswrt_dhcp_static_lease.lease_173": "router",
  "asuswrt_dhcp_static_lease.lease_43": "router",
  "asuswrt_dhcp_static_lease.lease_61": "router",
  "asuswrt_dhcp_static_lease.lease_90": "router",
  "asuswrt_dhcp_static_lease.plex_host": "router",
  "asuswrt_port_forward.mario_kart_http": "router",
  "asuswrt_port_forward.mario_kart_https": "router",
  "asuswrt_port_forward.minecraft_bedrock": "router",
  "asuswrt_port_forward.minecraft_mc_router": "router",
  "asuswrt_port_forward.minecraft_tsmc_bedrock": "router",
  "asuswrt_port_forward.plex": "router",
  "asuswrt_system.ax88u": "ap_ax88u",
  "asuswrt_system.be86u": "ap_be86u",
  "asuswrt_system.router": "router",
  "asuswrt_wireless_network.ax88u_wl0": "ap_ax88u",
  "asuswrt_wireless_network.ax88u_wl1": "ap_ax88u",
  "asuswrt_wireless_network.wl0": "router",
  "asuswrt_wireless_network.wl1": "router",
} as const;

test("asuswrt keeps every address of its state on the device that owns it", async () => {
  const { resource, ...rest } = await asuswrt();
  // State records each resource's provider alias, so a resource moved to
  // another device's provider would be planned against the wrong device.
  const owners = Object.fromEntries(
    Object.entries(resource).flatMap(([type, byName]) =>
      Object.entries(byName).map(([name, { provider }]) => [
        `${type}.${name}`,
        provider,
      ]),
    ),
  );
  expect(owners).toEqual(
    Object.fromEntries(
      Object.entries(ADDRESSES).map(([address, alias]) => [
        address,
        `asuswrt.${alias}`,
      ]),
    ),
  );
  expect(rest).not.toHaveProperty("import");
  expect(rest).not.toHaveProperty("moved");
  expect(rest).not.toHaveProperty("removed");
});

test("asuswrt configures one aliased provider per device with the shared login", async () => {
  const { provider, variable } = await asuswrt();
  expect(provider["asuswrt"]).toEqual(
    [
      { alias: "router", host: "192.168.1.1" },
      { alias: "ap_be86u", host: "192.168.1.2" },
      { alias: "ap_ax88u", host: "192.168.1.214" },
    ].map((device) => ({
      ...device,
      port: 8443,
      https: true,
      insecure: true,
      username: "${var.asuswrt_username}",
      password: "${var.asuswrt_password}",
    })),
  );
  expect(Object.keys(variable).toSorted()).toEqual([
    "asuswrt_password",
    "asuswrt_username",
  ]);
  expect(variable["asuswrt_password"]).toMatchObject({ sensitive: true });
  expect(variable["asuswrt_username"]).not.toHaveProperty("sensitive");
});

test("asuswrt never manages a wireless passphrase or the BE86U backhaul radios", async () => {
  const { resource } = await asuswrt();
  const wireless = resource["asuswrt_wireless_network"] ?? {};
  expect(Object.keys(wireless)).toHaveLength(4);
  for (const [name, network] of Object.entries(wireless)) {
    // Never read back from the device: managing it would hide drift.
    expect(network, name).not.toHaveProperty("wpa_passphrase");
    expect(network.provider, name).not.toBe("asuswrt.ap_be86u");
  }
  // Misspelled on the device; the name is the rule's identity.
  expect(resource["asuswrt_port_forward"]?.["minecraft_bedrock"]).toMatchObject(
    { name: "Mineraft Bedrock" },
  );
});

test("asuswrt requires exactly the provider version built from this repository", async () => {
  const { terraform } = await asuswrt();
  const pin = await asuswrtProviderPin();
  expect(pin.bindings).toBe(true);
  expect(terraform.required_providers).toEqual({
    asuswrt: { source: "shepherdjerred/asuswrt", version: pin.version },
  });
  expect(terraform.required_version).toBe(">= 1.6.0");
  expect(terraform).not.toHaveProperty("encryption");
});
