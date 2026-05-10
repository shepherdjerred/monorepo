import { LocalStorageManifestDatastore } from "./datastore/local-storage-manifest-datastore.ts";
import axios from "axios";
import { ManifestSchema, type Manifest } from "./parser/manifest.ts";

export class ManifestLoader {
  async load(): Promise<Manifest> {
    const datastore = new LocalStorageManifestDatastore();
    const cached = datastore.get();
    if (!cached || datastore.isStale()) {
      const response = await axios.get("/data/manifest.json");
      const manifest = ManifestSchema.parse(response.data);

      datastore.set(manifest);
      return manifest;
    }

    return cached;
  }
}
