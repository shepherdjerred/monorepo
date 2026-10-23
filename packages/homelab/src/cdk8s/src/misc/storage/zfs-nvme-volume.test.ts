import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { App } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { setupCharts } from "@shepherdjerred/homelab/cdk8s/src/setup-charts.ts";
import {
  NVME_STORAGE_CLASS,
  NVME_STORAGE_CLASS_LZ4,
} from "./storage-classes.ts";
import { ZFS_NVME_UNCOMPRESSED_CLAIMS } from "./zfs-nvme-uncompressed-claims.ts";
import { zfsNvmeStorageClass } from "./zfs-nvme-volume.ts";

const PvcSchema = z.object({
  kind: z.literal("PersistentVolumeClaim"),
  metadata: z.object({ name: z.string(), namespace: z.string() }),
  spec: z.object({ storageClassName: z.string() }),
});

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ZfsNvmeVolume storage class", () => {
  it("compresses new claims with lz4", () => {
    expect(zfsNvmeStorageClass("example", "new-claim")).toBe(
      NVME_STORAGE_CLASS_LZ4,
    );
  });

  it("keeps grandfathered claims on their immutable zfs-ssd class", () => {
    expect(zfsNvmeStorageClass("home", "homeassistant-pvc")).toBe(
      NVME_STORAGE_CLASS,
    );
  });

  it("grandfathers only claims that still render on zfs-ssd", async () => {
    const outdir = await mkdtemp(path.join(tmpdir(), "zfs-nvme-claims-"));
    tempDirectories.push(outdir);
    const app = new App({ outdir });
    await setupCharts(app);
    app.synth();

    const rendered = new Map<string, string>();
    for (const filename of await readdir(outdir)) {
      if (!filename.endsWith(".yaml")) continue;
      const text = await Bun.file(path.join(outdir, filename)).text();
      for (const document of parseAllDocuments(text)) {
        const pvc = PvcSchema.safeParse(document.toJS());
        if (!pvc.success) continue;
        const { metadata, spec } = pvc.data;
        rendered.set(
          `${metadata.namespace}/${metadata.name}`,
          spec.storageClassName,
        );
      }
    }

    expect(ZFS_NVME_UNCOMPRESSED_CLAIMS.size).toBeGreaterThan(0);
    for (const claim of ZFS_NVME_UNCOMPRESSED_CLAIMS) {
      // A retired claim must leave the list, or a later claim reusing its
      // name would silently lose lz4.
      expect(rendered.get(claim), claim).toBe(NVME_STORAGE_CLASS);
    }
  }, 30_000);
});
