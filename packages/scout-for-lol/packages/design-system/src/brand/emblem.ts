import { createElement, type SVGProps } from "react";
import {
  scoutMarkCircles,
  scoutMarkPaths,
  scoutMarkStroke,
  scoutMarkViewBox,
} from "./geometry.ts";

/**
 * Scout's compass/ward-eye emblem without JSX transform dependencies.
 *
 * The explicit createElement calls keep this component safe for both browser
 * bundles and Satori entrypoints loaded directly by Astro's config runner.
 */
export function ScoutEmblem(props: SVGProps<SVGSVGElement>) {
  return createElement(
    "svg",
    {
      viewBox: scoutMarkViewBox,
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
      "aria-hidden": props["aria-label"] === undefined ? "true" : undefined,
      ...props,
    },
    createElement("path", {
      d: scoutMarkPaths.hexagon,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: scoutMarkStroke.ui,
    }),
    createElement("path", {
      d: scoutMarkPaths.star,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: scoutMarkStroke.ui,
      strokeLinejoin: "round",
    }),
    createElement("circle", {
      cx: scoutMarkCircles.ring.cx,
      cy: scoutMarkCircles.ring.cy,
      r: scoutMarkCircles.ring.r,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: scoutMarkStroke.ui,
    }),
    createElement("circle", {
      cx: scoutMarkCircles.pupil.cx,
      cy: scoutMarkCircles.pupil.cy,
      r: scoutMarkCircles.pupil.r,
      fill: "currentColor",
    }),
  );
}
