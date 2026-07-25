import { Resvg } from "@resvg/resvg-js";
import * as echarts from "echarts";

export function echartsOptionToSvg(
  option: echarts.EChartsOption,
  width: number,
  height: number,
): string {
  const chart = echarts.init(null, null, {
    renderer: "svg",
    ssr: true,
    width,
    height,
  });
  try {
    chart.setOption(option);
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

export function echartsSvgToImage(
  svg: string,
  fontFiles: string[],
  defaultFontFamily: string,
): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "original" },
    font: { loadSystemFonts: false, fontFiles, defaultFontFamily },
  });
  return resvg.render().asPng();
}
