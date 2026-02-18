type DamageProps = {
  value: number;
  percent: number;
  highlight: boolean;
  containerGap?: number | string;
  containerWidth?: string;
  containerMinWidth?: number;
  textGap?: number | string;
  textFontSize?: number;
  textFontWeight?: number;
  textColor?: string;
  textLayout?: "simple" | "split";
  barWidth?: number | string;
  barHeight?: number | string;
  barBackgroundColor?: string;
  barBorderRadius?: number;
  barOverflow?: string;
  fillHighlightColor?: string;
  fillDefaultColor?: string;
  fillBorderRadius?: number;
};

export function Damage({
  value,
  percent,
  highlight,
  containerGap = "2rem",
  containerWidth,
  containerMinWidth,
  textGap = "2rem",
  textFontSize,
  textFontWeight = 700,
  textColor,
  textLayout = "simple",
  barWidth = "20rem",
  barHeight = "1.5rem",
  barBackgroundColor,
  barBorderRadius,
  barOverflow,
  fillHighlightColor,
  fillDefaultColor,
  fillBorderRadius,
}: DamageProps) {
  const fillColor = highlight ? fillHighlightColor : fillDefaultColor;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: containerGap,
        ...(containerWidth !== undefined && containerWidth.length > 0 ? { width: containerWidth } : {}),
        ...(containerMinWidth === undefined
          ? {}
          : { minWidth: containerMinWidth }),
      }}
    >
      {textLayout === "simple" ? (
        <div
          style={{
            display: "flex",
            gap: textGap,
            fontWeight: textFontWeight,
            ...(textColor !== undefined && textColor.length > 0 ? { color: textColor } : {}),
          }}
        >
          {value.toLocaleString()} dmg
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            gap: textGap,
            ...(textFontSize === undefined ? {} : { fontSize: textFontSize }),
            fontWeight: textFontWeight,
            ...(textColor !== undefined && textColor.length > 0 ? { color: textColor } : {}),
          }}
        >
          <span>{value.toLocaleString()}</span>
          <span>dmg</span>
        </div>
      )}
      <span
        style={{
          width: barWidth,
          height: barHeight,
          backgroundColor: barBackgroundColor,
          ...(barBorderRadius === undefined
            ? {}
            : { borderRadius: barBorderRadius }),
          ...(barOverflow !== undefined && barOverflow.length > 0 ? { overflow: barOverflow } : {}),
        }}
      >
        <span
          style={{
            display: "flex",
            width: `${percent.toString()}%`,
            height: "100%",
            backgroundColor: fillColor,
            ...(fillBorderRadius === undefined
              ? {}
              : { borderRadius: fillBorderRadius }),
          }}
        />
      </span>
    </div>
  );
}
