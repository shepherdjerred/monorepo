import { fileURLToPath } from "node:url";
import { satoriFontUrl } from "./assets.ts";

export function satoriFontFilePath(relativePath: string): string {
  return fileURLToPath(satoriFontUrl(relativePath));
}
