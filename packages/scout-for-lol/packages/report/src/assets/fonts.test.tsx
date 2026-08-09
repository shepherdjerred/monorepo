import { describe, expect, test } from "bun:test";
import satori from "satori";
import {
  bunReportFonts,
  cjkFontFileName,
  containsCjkText,
  font,
  fontForText,
} from "#src/assets/index.ts";
import { svgToPng } from "#src/html/index.tsx";

describe("report fonts", () => {
  test("renders CJK player names in both SVG and PNG output", async () => {
    const playerName = "한국어 中文 日本語";
    expect(containsCjkText(playerName)).toBe(true);
    expect(containsCjkText("ㄅㄆㄇ")).toBe(true);
    expect(containsCjkText("Summoner One")).toBe(false);
    expect(cjkFontFileName("한국어")).toBe("NotoSansCJKkr-Regular.otf");
    expect(cjkFontFileName("日本語かな")).toBe("NotoSansCJKjp-Regular.otf");
    expect(cjkFontFileName("ㄅㄆㄇ")).toBe("NotoSansCJKtc-Regular.otf");
    expect(cjkFontFileName("中文")).toBe("NotoSansCJKsc-Regular.otf");
    expect(fontForText("body", "한국어")).toStartWith(
      "Spiegel, Noto Sans CJK KR",
    );
    expect(fontForText("body", "日本語かな")).toStartWith(
      "Spiegel, Noto Sans CJK JP",
    );
    expect(fontForText("body", "中文")).toStartWith(
      "Spiegel, Noto Sans CJK SC",
    );
    expect(fontForText("body", "Summoner One")).toBe("Spiegel");

    const fonts = await bunReportFonts(containsCjkText(playerName), playerName);

    expect(
      fonts.some((entry) => entry.name === "Noto Sans CJK JP") &&
        fonts.some((entry) => entry.name === "Noto Sans CJK KR") &&
        fonts.some((entry) => entry.name === "Noto Sans CJK SC") &&
        fonts.some((entry) => entry.name === "Noto Sans CJK TC"),
    ).toBe(true);

    const svg = await satori(
      <div style={{ fontFamily: font.body }}>{playerName}</div>,
      { width: 600, height: 100, fonts },
    );

    expect(svg).toContain("<path");

    const png = await svgToPng(svg, { crop: false });
    expect(Buffer.from(png).subarray(0, 8).toString("hex")).toBe(
      "89504e470d0a1a0a",
    );
    expect(png.byteLength).toBeGreaterThan(100);
  });
});
