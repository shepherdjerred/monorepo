import { LocalStorageManifestDatastore } from "./datastore/local-storage-manifest-datastore.ts";
import axios from "axios";
import type { Manifest } from "./parser/manifest.ts";

export class ManifestLoader {
  async load(): Promise<Manifest> {
    const datastore = new LocalStorageManifestDatastore();
    const cached = datastore.get();
    if (!cached || datastore.isStale()) {
      const response = await axios.get("/data/manifest.json");
      const manifest = response.data as Manifest;

      datastore.set(manifest);
      return manifest;
    }

    return cached;
  }
}
