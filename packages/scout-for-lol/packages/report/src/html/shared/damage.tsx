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

function optionalStyle<T>(
  value: T | undefined,
  key: string,
): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function optionalStringStyle(
  value: string | undefined,
  key: string,
): Record<string, string> {
  return value !== undefined && value.length > 0 ? { [key]: value } : {};
}

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
        ...optionalStringStyle(containerWidth, "width"),
        ...optionalStyle(containerMinWidth, "minWidth"),
      }}
    >
      {textLayout === "simple" ? (
        <div
          style={{
            display: "flex",
            gap: textGap,
            fontWeight: textFontWeight,
            ...optionalStringStyle(textColor, "color"),
          }}
        >
          {value.toLocaleString()} dmg
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            gap: textGap,
            ...optionalStyle(textFontSize, "fontSize"),
            fontWeight: textFontWeight,
            ...optionalStringStyle(textColor, "color"),
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
          ...optionalStyle(barBorderRadius, "borderRadius"),
          ...optionalStringStyle(barOverflow, "overflow"),
        }}
      >
        <span
          style={{
            display: "flex",
            width: `${percent.toString()}%`,
            height: "100%",
            backgroundColor: fillColor,
            ...optionalStyle(fillBorderRadius, "borderRadius"),
          }}
        />
      </span>
    </div>
  );
}
