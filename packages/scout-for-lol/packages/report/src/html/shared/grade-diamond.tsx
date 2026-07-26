import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import type { Grade } from "#src/html/shared/grade.ts";

/**
 * D/C/B/A/S/S+ rhombus badge. Renders as a diamond (rotated-square) outline with
 * the grade letter centered inside (un-rotated).
 *
 * `size` is the bounding-box edge length in rem. The badge content always
 * scales proportionally.
 *
 * The diamond is drawn as an inline **SVG polygon** rather than a CSS
 * `transform: rotate(45deg)` div: satori/resvg rasterizes a rotated div's
 * bounding box off-center by several pixels in a layout-dependent direction
 * (measured +11px in the banner squad row, -7px in the square card), which made
 * the (correctly box-centered) letter read as off-center. An SVG polygon
 * rasterizes symmetrically, so the letter and diamond both sit on the box center
 * with no per-glyph padding fudge.
 */
export function GradeDiamond({
  grade,
  size = 10,
}: {
  grade: Grade;
  size?: number;
}) {
  // S / S+ get the bright gold treatment, everything else uses the soft gold.
  const accent =
    grade === "S+" || grade === "S" ? palette.gold[4] : palette.gold[1];
  const fontSize = grade === "S+" ? size * 0.45 : size * 0.55;

  // The diamond is a size×size square rotated 45°, so its bounding box is
  // size·√2. Draw it in an axis-aligned SVG that overflows the size×size letter
  // box symmetrically (offset by half the extra extent on each side).
  const bbox = size * Math.SQRT2;
  const overflow = (bbox - size) / 2;
  // Stroke is centered on the polygon path; convert the rem border width into
  // the 0–100 viewBox and inset the points by half of it so it isn't clipped.
  const strokeView = ((size * 0.04) / bbox) * 100;
  const inset = (strokeView / 2).toString();
  const far = (100 - strokeView / 2).toString();
  const sw = strokeView.toString();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="50,${inset} ${far},50 50,${far} ${inset},50" fill="rgba(1,10,19,0.55)" stroke="${accent}" stroke-width="${sw}" stroke-linejoin="miter"/></svg>`;
  const diamondUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  return (
    <div
      style={{
        width: `${size.toString()}rem`,
        height: `${size.toString()}rem`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: `${(-overflow).toString()}rem`,
          left: `${(-overflow).toString()}rem`,
          width: `${bbox.toString()}rem`,
          height: `${bbox.toString()}rem`,
          display: "flex",
          backgroundImage: `url(${diamondUri})`,
          backgroundSize: "100% 100%",
        }}
      />
      <span
        style={{
          fontFamily: font.title,
          fontSize: `${fontSize.toString()}rem`,
          color: accent,
          fontWeight: 700,
          lineHeight: 1,
          display: "flex",
          position: "relative",
        }}
      >
        {grade}
      </span>
    </div>
  );
}
