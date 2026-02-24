import { StyleSheet } from "react-native";

export const typography = StyleSheet.create({
  title: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  heading: {
    fontSize: 22,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  subheading: {
    fontSize: 17,
    fontWeight: "600",
  },
  body: {
    fontSize: 16,
    fontWeight: "400",
    lineHeight: 22,
  },
  bodySmall: {
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 20,
  },
  caption: {
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: 0.3,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
