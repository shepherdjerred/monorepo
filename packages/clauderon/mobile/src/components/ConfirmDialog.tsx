import React from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "default" | "destructive";
  loading?: boolean;
};

export function ConfirmDialog({
  visible,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  variant = "default",
  loading = false,
}: ConfirmDialogProps) {
  const confirmButtonColor =
    variant === "destructive" ? colors.error : colors.primary;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={onCancel}
              disabled={loading}
            >
              <Text style={styles.cancelButtonText}>{cancelLabel}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.button,
                styles.confirmButton,
                { backgroundColor: confirmButtonColor },
                loading && styles.buttonDisabled,
              ]}
              onPress={onConfirm}
              disabled={loading}
            >
              <Text style={styles.confirmButtonText}>
                {loading ? "..." : confirmLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  dialog: {
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.border,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    ...Platform.select({
      ios: {
        shadowColor: colors.border,
        shadowOffset: { width: 6, height: 6 },
        shadowOpacity: 1,
        shadowRadius: 0,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  title: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  description: {
    fontSize: typography.fontSize.base,
    color: colors.text,
    lineHeight: typography.fontSize.base * typography.lineHeight.normal,
    marginBottom: 24,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
  },
  button: {
    flex: 1,
    borderWidth: 3,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    ...Platform.select({
      ios: {
        shadowColor: colors.border,
        shadowOffset: { width: 3, height: 3 },
        shadowOpacity: 1,
        shadowRadius: 0,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  cancelButton: {
    backgroundColor: colors.surface,
  },
  confirmButton: {
    backgroundColor: colors.primary,
  },
  cancelButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
  },
  confirmButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colors.textWhite,
    textTransform: "uppercase",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
