import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import {
  VISUALIZATION_BODY_FONT,
  VISUALIZATION_DISPLAY_FONT,
} from "@scout-for-lol/report/browser";

/**
 * Shared title / body / axis-tooltip chrome for in-app profile charts.
 * Rank-history and match-timeline keep their own axes, grids, and series.
 */
export function profileChartChrome(
  title: string,
  tooltip?: { formatter: (items: unknown) => string },
): Pick<echarts.EChartsOption, "textStyle" | "title" | "tooltip"> {
  return {
    textStyle: { fontFamily: VISUALIZATION_BODY_FONT },
    title: {
      text: title,
      left: 12,
      top: 8,
      textStyle: {
        fontSize: 14,
        fontFamily: VISUALIZATION_DISPLAY_FONT,
        fontWeight: 700,
      },
    },
    tooltip: {
      trigger: "axis",
      textStyle: { fontFamily: VISUALIZATION_BODY_FONT },
      ...(tooltip === undefined ? {} : { formatter: tooltip.formatter }),
    },
  };
}

export function ProfileEchartsHost(props: {
  title: string;
  option: echarts.EChartsOption;
  revision: unknown;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const optionRef = useRef(props.option);
  optionRef.current = props.option;

  useEffect(() => {
    if (container.current === null) return;
    const chart = echarts.init(container.current);
    chart.setOption(optionRef.current);
    const observer = new ResizeObserver(() => {
      chart.resize();
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [props.revision, props.title]);

  return (
    <div
      ref={container}
      className="h-72 rounded-md border bg-card"
      role="img"
      aria-label={props.title}
    />
  );
}
