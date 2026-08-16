import {
  bunBeaufortFonts as loadBeaufortFonts,
  bunCjkFonts as loadCjkFonts,
  bunReportFonts as loadReportFonts,
  bunSpiegelFonts as loadSpiegelFonts,
  cjkFontFileName as resolveCjkFontFileName,
  cjkFontFileNames as cjkFontFileNamesSource,
  containsCjkText as valueContainsCjkText,
  font as fontSource,
  fontFamilyForText as resolveFontFamilyForText,
  fontForText as resolveFontForText,
} from "@scout-for-lol/design-system/satori/fonts";
import type { Font } from "satori";

export const font = { ...fontSource };
export const cjkFontFileNames = [...cjkFontFileNamesSource];

export function bunBeaufortFonts(): Promise<Font[]> {
  return loadBeaufortFonts();
}

export function bunSpiegelFonts(): Promise<Font[]> {
  return loadSpiegelFonts();
}

export function bunCjkFonts(value: unknown = ""): Promise<Font[]> {
  return loadCjkFonts(value);
}

export function bunReportFonts(
  includeCjkFallback = false,
  cjkText: unknown = "",
): Promise<Font[]> {
  return loadReportFonts(includeCjkFallback, cjkText);
}

export function cjkFontFileName(value: unknown): string {
  return resolveCjkFontFileName(value);
}

export function containsCjkText(value: unknown): boolean {
  return valueContainsCjkText(value);
}

export function fontFamilyForText(
  baseFontFamily: string,
  value: unknown,
): string {
  return resolveFontFamilyForText(baseFontFamily, value);
}

export function fontForText(
  fontKind: "title" | "body",
  value: unknown,
): string {
  return resolveFontForText(fontKind, value);
}
