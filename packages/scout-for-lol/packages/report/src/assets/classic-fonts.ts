import { bunClassicFonts as loadClassicFonts } from "@scout-for-lol/design-system/satori/classic-fonts";
import type { Font } from "satori";

export function bunClassicFonts(): Promise<Font[]> {
  return loadClassicFonts();
}
