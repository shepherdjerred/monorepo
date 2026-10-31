import { resolve } from "node:path";
import { verifyNativeArtifacts } from "./native-artifacts";

await verifyNativeArtifacts(resolve(import.meta.dir, ".."));
console.log("Native artifacts match the current complete producer inventory.");
