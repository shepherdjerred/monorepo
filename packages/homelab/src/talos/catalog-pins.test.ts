import { expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import {
  parseVersionCatalog,
  upstreamName,
  type VersionCatalogEntry,
} from "@shepherdjerred/version-catalog";
import rawVersionCatalog from "@shepherdjerred/version-catalog/catalog.json";

/**
 * The `cluster-nodes` components (Delivery model X13) are the images each
 * node runs today: its Talos factory installer and the kubelet. They pin the
 * same releases as the Talos and Kubernetes source entries, and each
 * installer is exactly its node's machine-config image, so a version change
 * moves every pin together with the live upgrade.
 */
const catalog = parseVersionCatalog(rawVersionCatalog);
function entry(name: string): VersionCatalogEntry {
  const found = catalog.entries.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`Version catalog lacks ${name}`);
  return found;
}

const InstallSchema = z.looseObject({
  machine: z.looseObject({
    install: z.looseObject({ image: z.string() }),
  }),
});

async function installerImage(node: string): Promise<string> {
  const text = await Bun.file(
    new URL(`${node}/patches/image.yaml`, import.meta.url),
  ).text();
  const [machine] = parseAllDocuments(text);
  return InstallSchema.parse(machine?.toJSON()).machine.install.image;
}

test("each node's installer component is its machine-config image at the Talos release", async () => {
  const talos = entry("siderolabs/talos").value;
  for (const node of ["liskov", "torvalds"]) {
    const installer = entry(`siderolabs/installer-${node}`);
    expect(installer.component, node).toBe(true);
    expect(installer.value.startsWith(`v${talos}@sha256:`), node).toBe(true);
    expect(
      `factory.talos.dev/${upstreamName(installer)}:${installer.value}`,
    ).toBe(await installerImage(node));
  }
});

test("the kubelet component pins the Kubernetes release", () => {
  const kubelet = entry("siderolabs/kubelet");
  expect(kubelet.component).toBe(true);
  expect(kubelet.value).toMatch(/^v[\d.]+@sha256:[a-f0-9]{64}$/u);
  expect(kubelet.value.slice(0, kubelet.value.indexOf("@"))).toBe(
    entry("kubernetes/kubernetes").value,
  );
});
