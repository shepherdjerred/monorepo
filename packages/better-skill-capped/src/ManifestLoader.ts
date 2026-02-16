import { LocalStorageManifestDatastore } from "./datastore/LocalStorageManifestDatastore";
import axios from "axios";
import { Manifest } from "./parser/Manifest";

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
