import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import type { Grade } from "#src/html/shared/grade.ts";

/**
 * D/C/B/A/S/S+ rhombus badge. Renders as a rotated square outline with the
 * grade letter centered inside (un-rotated).
 *
 * `size` is the bounding-box edge length in rem. The badge content always
 * scales proportionally.
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
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "flex",
          border: `${(size * 0.04).toString()}rem solid ${accent}`,
          transform: "rotate(45deg)",
          backgroundColor: "rgba(1, 10, 19, 0.55)",
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
