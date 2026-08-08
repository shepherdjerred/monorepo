import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingBottom: 28 },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 8,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  errorCopy: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  retryButton: {
    minHeight: 44,
    borderRadius: 10,
    justifyContent: "center",
    paddingHorizontal: 18,
    marginTop: 4,
  },
  retryText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  inlineError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  inlineErrorText: { flex: 1, fontSize: 13, lineHeight: 18 },
});
