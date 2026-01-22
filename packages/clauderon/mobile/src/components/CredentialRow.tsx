import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import type { CredentialStatus } from "../types/generated";
import { useTheme } from "../contexts/ThemeContext";
import { typography } from "../styles/typography";

type CredentialRowProps = {
  credential: CredentialStatus;
  onSave: (serviceId: string, value: string) => Promise<void>;
};

export function CredentialRow({ credential, onSave }: CredentialRowProps) {
  const { colors } = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showValue, setShowValue] = useState(false);

  const handleSave = useCallback(async () => {
    if (!value.trim()) return;

    setIsSaving(true);
    try {
      await onSave(credential.service_id, value.trim());
      setValue("");
      setIsEditing(false);
    } catch (error) {
      Alert.alert(
        "Error",
        `Failed to save credential: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsSaving(false);
    }
  }, [credential.service_id, value, onSave]);

  const handleCancel = () => {
    setValue("");
    setIsEditing(false);
  };

  const themedStyles = getThemedStyles(colors);

  return (
    <View style={themedStyles.container}>
      <View style={styles.header}>
        <View style={styles.nameRow}>
          <View
            style={[
              themedStyles.statusDot,
              credential.available
                ? { backgroundColor: colors.success }
                : { backgroundColor: colors.error },
            ]}
          />
          <Text style={[styles.name, { color: colors.textDark }]}>{credential.name}</Text>
        </View>
        {credential.readonly && (
          <View
            style={[
              styles.readonlyBadge,
              { backgroundColor: colors.textLight, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.readonlyText, { color: colors.textWhite }]}>Readonly</Text>
          </View>
        )}
      </View>

      {credential.available && credential.masked_value && (
        <View style={styles.valueRow}>
          <Text style={[styles.maskedValue, { color: colors.textLight }]}>
            {showValue ? credential.masked_value : "••••••••••••"}
          </Text>
          <TouchableOpacity
            style={[styles.showButton, { borderColor: colors.border }]}
            onPress={() => {
              setShowValue(!showValue);
            }}
          >
            <Text style={[styles.showButtonText, { color: colors.textDark }]}>
              {showValue ? "Hide" : "Show"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {credential.source && (
        <Text style={[styles.source, { color: colors.textLight }]}>
          Source: {credential.source}
        </Text>
      )}

      {!credential.readonly && (
        <>
          {isEditing ? (
            <View style={styles.editRow}>
              <TextInput
                style={[themedStyles.input, { color: colors.text }]}
                value={value}
                onChangeText={setValue}
                placeholder="Enter credential value"
                placeholderTextColor={colors.textLight}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={styles.editActions}>
                <TouchableOpacity
                  style={themedStyles.cancelButton}
                  onPress={handleCancel}
                  disabled={isSaving}
                >
                  <Text style={[styles.cancelButtonText, { color: colors.textDark }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    themedStyles.saveButton,
                    (!value.trim() || isSaving) && styles.buttonDisabled,
                  ]}
                  onPress={() => void handleSave()}
                  disabled={!value.trim() || isSaving}
                >
                  {isSaving ? (
                    <ActivityIndicator size="small" color={colors.textWhite} />
                  ) : (
                    <Text style={[styles.saveButtonText, { color: colors.textWhite }]}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={themedStyles.editButton}
              onPress={() => {
                setIsEditing(true);
              }}
            >
              <Text style={[styles.editButtonText, { color: colors.textDark }]}>
                {credential.available ? "Update" : "Add"}
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

// Dynamic styles based on theme colors
function getThemedStyles(colors: {
  surface: string;
  border: string;
  background: string;
  primary: string;
}) {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: colors.border,
      padding: 12,
      marginBottom: 8,
      ...Platform.select({
        ios: {
          shadowColor: colors.border,
          shadowOffset: { width: 2, height: 2 },
          shadowOpacity: 1,
          shadowRadius: 0,
        },
        android: {
          elevation: 2,
        },
      }),
    },
    statusDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: colors.border,
    },
    input: {
      backgroundColor: colors.background,
      borderWidth: 2,
      borderColor: colors.border,
      padding: 10,
      fontSize: typography.fontSize.base,
      marginBottom: 8,
    },
    cancelButton: {
      flex: 1,
      paddingVertical: 10,
      borderWidth: 2,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center" as const,
    },
    saveButton: {
      flex: 1,
      paddingVertical: 10,
      borderWidth: 2,
      borderColor: colors.border,
      backgroundColor: colors.primary,
      alignItems: "center" as const,
    },
    editButton: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderWidth: 2,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignSelf: "flex-start" as const,
      marginTop: 4,
    },
  });
}

// Static styles (layout only, no colors)
const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
  },
  readonlyBadge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderWidth: 1,
  },
  readonlyText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  maskedValue: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
  },
  showButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
  },
  showButtonText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
  source: {
    fontSize: typography.fontSize.xs,
    marginBottom: 8,
  },
  editRow: {
    marginTop: 8,
  },
  editActions: {
    flexDirection: "row",
    gap: 8,
  },
  cancelButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
  saveButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  editButtonText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
});
