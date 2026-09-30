import { satoriFontFilePath } from "@scout-for-lol/design-system/satori/file-assets";

export const ANALYTICS_CHART_WIDTH = 1600;
export const ANALYTICS_CHART_HEIGHT = 900;
export const ANALYTICS_TITLE_FONT = "Beaufort for LOL";
export const ANALYTICS_BODY_FONT = "Spiegel";
export const ANALYTICS_FONT_FILE_PATHS = [
  "Spiegel-TTF/Spiegel_TT_Regular.ttf",
  "Spiegel-TTF/Spiegel_TT_SemiBold.ttf",
  "Spiegel-TTF/Spiegel_TT_Bold.ttf",
  "BeaufortForLoL-TTF/BeaufortforLOL-Regular.ttf",
  "BeaufortForLoL-TTF/BeaufortforLOL-Bold.ttf",
  "BeaufortForLoL-TTF/BeaufortforLOL-Heavy.ttf",
].map((relativePath) => satoriFontFilePath(relativePath));
