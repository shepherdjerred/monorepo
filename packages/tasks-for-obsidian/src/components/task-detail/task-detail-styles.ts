import { StyleSheet } from "react-native";

export const taskDetailStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  card: {
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  chipCard: {
    paddingTop: 16,
  },
  titleInput: {
    minHeight: 54,
    paddingVertical: 12,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "600",
  },
  detailsInput: {
    minHeight: 88,
    paddingVertical: 12,
    fontSize: 16,
    lineHeight: 22,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
  },
  sectionTitle: {
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 14,
  },
  fieldLabel: {
    marginTop: 20,
    marginBottom: 10,
    marginLeft: 14,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 36,
  },
  actionRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  formRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  rowLabelGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rowValueGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 1,
  },
  menu: {
    width: "100%",
  },
  anchorRow: {
    flexDirection: "row",
    gap: 8,
    paddingBottom: 14,
  },
  anchorOption: {
    minHeight: 44,
    flex: 1,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  estimateInput: {
    minWidth: 52,
    minHeight: 44,
    marginLeft: "auto",
    textAlign: "right",
    fontSize: 16,
  },
  fieldError: {
    marginBottom: 10,
    marginLeft: 29,
  },
  pressed: {
    opacity: 0.6,
  },
  deleteButton: {
    minHeight: 52,
    marginTop: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
});
