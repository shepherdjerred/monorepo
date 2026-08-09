export const classicPalette = {
  canvas: "#050D17",
  panel: "#06111B",
  raised: "#0F1322",
  steel: {
    deep: "#1B344D",
    accent: "#2D6892",
    highlight: "#6E90AF",
  },
  red: {
    deep: "#210C0C",
    accent: "#992E1E",
    highlight: "#C89B93",
  },
  gold: {
    shadow: "#5A472A",
    base: "#BF9869",
    highlight: "#E1C978",
  },
  text: {
    strong: "#F2ECDB",
    primary: "#E7E2D3",
    secondary: "#A4A9AD",
  },
  parchment: {
    base: "#E5D5A0",
    raised: "#EBDEAA",
    highlight: "#F2ECDB",
    border: "#C8B275",
    ink: "#273D47",
  },
} as const;

export const classicTypography = {
  family: {
    display: "QTFrizQuad",
    body: "Gill Sans",
  },
  stack: {
    display:
      "QTFrizQuad, Noto Sans CJK KR, Noto Sans CJK JP, Noto Sans CJK TC, Noto Sans CJK SC",
    body: "Gill Sans, Noto Sans CJK KR, Noto Sans CJK JP, Noto Sans CJK TC, Noto Sans CJK SC",
  },
  size: {
    xl: { fontSize: 64, lineHeight: "64px" },
    large: { fontSize: 44, lineHeight: "48px" },
    medium: { fontSize: 28, lineHeight: "32px" },
    bodyLarge: { fontSize: 22, lineHeight: "28px" },
    bodyMedium: { fontSize: 20, lineHeight: "24px" },
    caption: { fontSize: 16, lineHeight: "20px" },
  },
} as const;
