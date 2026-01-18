import React from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import { useTheme } from "../contexts/ThemeContext";
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
  const { colors } = useTheme();
  const confirmButtonColor =
    variant === "destructive" ? colors.error : colors.primary;

  const themedStyles = getThemedStyles(colors);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={themedStyles.dialog}>
          <Text style={[styles.title, { color: colors.textDark }]}>{title}</Text>
          <Text style={[styles.description, { color: colors.text }]}>{description}</Text>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[themedStyles.button, { backgroundColor: colors.surface }]}
              onPress={onCancel}
              disabled={loading}
            >
              <Text style={[styles.buttonText, { color: colors.textDark }]}>{cancelLabel}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                themedStyles.button,
                { backgroundColor: confirmButtonColor },
                loading && styles.buttonDisabled,
              ]}
              onPress={onConfirm}
              disabled={loading}
            >
              <Text style={[styles.buttonText, { color: colors.textWhite }]}>
                {loading ? "..." : confirmLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function getThemedStyles(colors: { surface: string; border: string }) {
  return StyleSheet.create({
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
    button: {
      flex: 1,
      borderWidth: 3,
      borderColor: colors.border,
      paddingVertical: 12,
      paddingHorizontal: 16,
      alignItems: "center" as const,
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
  });
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  title: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  description: {
    fontSize: typography.fontSize.base,
    lineHeight: typography.fontSize.base * typography.lineHeight.normal,
    marginBottom: 24,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
  },
  buttonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
