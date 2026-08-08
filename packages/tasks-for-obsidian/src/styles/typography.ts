import { StyleSheet } from "react-native";

export const dynamicTypeRamps = {
  title: "title1",
  heading: "title2",
  subheading: "headline",
  body: "body",
  bodySmall: "subheadline",
  caption: "caption1",
  label: "footnote",
} as const;

export const typography = StyleSheet.create({
  title: {
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
  },
  heading: {
    fontSize: 22,
    fontWeight: "600",
    lineHeight: 28,
  },
  subheading: {
    fontSize: 17,
    fontWeight: "600",
    lineHeight: 22,
  },
  body: {
    fontSize: 17,
    fontWeight: "400",
    lineHeight: 22,
  },
  bodySmall: {
    fontSize: 15,
    fontWeight: "400",
    lineHeight: 20,
  },
  caption: {
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
});
