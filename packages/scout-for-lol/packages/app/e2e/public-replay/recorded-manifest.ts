import { ReplayRenderPackageManifestSchema as PublicManifestSchema } from "@scout-for-lol/domain/artifacts/replay-support.ts";
import { z } from "zod";
import { LocalScoutTerrainManifestSchema } from "./local-scout-terrain-manifest.ts";

export const ReplayRenderPackageManifestSchema = z.union([
  PublicManifestSchema,
  LocalScoutTerrainManifestSchema,
]);
