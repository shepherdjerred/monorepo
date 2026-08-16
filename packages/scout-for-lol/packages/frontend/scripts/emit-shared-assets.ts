import {
  copyScoutAssets,
  verifyScoutAssetBucket,
} from "@scout-for-lol/design-system/build";
import { fileURLToPath } from "node:url";

const outputRoot = fileURLToPath(new URL("../dist/", import.meta.url));

await copyScoutAssets(outputRoot);
await verifyScoutAssetBucket(outputRoot);

console.log("Emitted and verified the complete shared Scout asset corpus");
